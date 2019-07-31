import { APIGatewayProxyHandler, Context, Callback } from 'aws-lambda'
import 'source-map-support/register'
import dotenv from 'dotenv'
import { Response, File } from './model/Models'
import { Database } from './database/Database'
import * as pathUtil from 'path'
import { lambda, downloadBucket, s3 } from './config/Config'
import axios from 'axios'

const database = new Database()

interface DownloadResult {
  file: File, 
  success: boolean, 
  error?: Error
}

export const run: APIGatewayProxyHandler = async (_event: any = {}, _context: Context, _callback: Callback): Promise<any> => {
  dotenv.config()
  try {
    //list files that have not yet been downloaded yet
    const files = await database.listDownloads()
    const results = await downloadFiles(files, downloadBucket)
    const result: Response = {
      statusCode: 200,
      body: JSON.stringify(results),
      isBase64Encoded: false
    }
    return result
  } catch (error) {
    console.error("Download files failed", error)
    const failed: Response = {
      statusCode: 400,
      body: (error.message || 'Unknown error'),
      isBase64Encoded: false
    }
    return failed
  }
}

async function downloadFiles(files: File[], bucket: string) {
  let downloads = []
  files.forEach(file => {
    downloads.push(startDownload(file, bucket))
  })
  return Promise.all(downloads)
}

async function startDownload(file: File, bucket: string): Promise<DownloadResult> {
  const available = await fileAvailable(file)
  if (!available) {
    console.debug('Download is not ready yet, will wait for next scheduled check...')
    return { success: false, file }
  }
  const exists = await checkAlreadyDownloaded(file, bucket)
  if (exists) {
    console.debug(`Object already exists, skipping... (Key: ${file})`)
    return { success: true, file }
  }
  console.debug(`Downloading file: ${file}`)
  try {
    await lambda.invoke({
      LogType: "Tail",
      FunctionName: 'file-downloader-dev-downloadFile',
      Payload: JSON.stringify({ path: file, bucket }) // pass params
    }).promise()
    return {success: true, file}
  } catch (error) {
    console.error(`Error executing lambda due to: ${error}`)
    return {success: false, file, error}
  }
}

async function fileAvailable(file: File): Promise<Boolean> {
  try {
    const response = await axios.head(file.downloadPath)
    return response.status === 200
  } catch (error) {
    console.warn(`Unable to check head status of file: ${file.downloadPath} due to error: ${error.message}`)
    return false
  }
}

async function checkAlreadyDownloaded(file: File, bucket: string): Promise<Boolean> {
  const parsed = pathUtil.parse(file.downloadPath)
  const key = `${parsed.name}.csv`
  const params = {
    Bucket: bucket,
    Key: key
  }
  try {
    await s3.headObject(params).promise()
    console.log('Object exists...')
    return true
  } catch (err) {
    console.log('Object does not exist...')
    return false
  }
}
