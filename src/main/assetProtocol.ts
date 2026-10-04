import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { directoryRoots, within } from './directoryProject'

export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'storyloom-asset', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
}

export function installAssetProtocol(): void {
  protocol.handle('storyloom-asset', (request) => {
    try {
      const url = new URL(request.url), root = directoryRoots.get(url.hostname)
      if (!root) return new Response('素材工程未打开', { status: 404 })
      return net.fetch(pathToFileURL(within(root, decodeURIComponent(url.pathname.slice(1)))).href, { headers: request.headers })
    } catch { return new Response('素材路径无效', { status: 403 }) }
  })
}
