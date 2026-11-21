import { QueueClient } from '@vercel/queue'
import {consume} from '../server/jobs.js'
export default new QueueClient({region:'iad1'}).handleNodeCallback(consume)
