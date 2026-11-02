import { randomUUID } from 'node:crypto'

import type {
  ImageProvider,
  MediaResource,
} from './types.js'
import { inspectImage } from './validation.js'

export class MediaService {
  constructor(
    private readonly provider: ImageProvider,
    private readonly folder: string,
    private readonly createId: () => string = randomUUID,
  ) {}

  async uploadImage(resource: MediaResource, file: File) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const inspected = inspectImage(buffer, file.type)
    const publicId = `${this.folder}/${resource}/${this.createId()}`
    return this.provider.upload({
      buffer,
      publicId,
      format: inspected.format,
    })
  }
}
