import { config } from 'dotenv'

import { extractPageContent } from '../integrations/web-extraction/index.ts'

config({ path: '.env.local' })

const urls = [
  'https://example.com',
  'https://news.ycombinator.com',
  'https://quotes.toscrape.com/js/',
  'https://httpbin.org/status/404',
  'https://this-domain-definitely-does-not-exist-snaprime-test.com',
]

for (const url of urls) {
  console.log('\n=== ' + url + ' ===')
  const start = Date.now()
  const result = await extractPageContent(url)
  const elapsed = Date.now() - start
  console.log('elapsed ms:', elapsed)
  if (!result.success) {
    console.log('FAIL:', result.errorReason)
    continue
  }
  console.log(
    'source:',
    result.source,
    '| partial:',
    result.partial,
    result.partialReason ?? '',
  )
  console.log('title:', result.content.title)
  console.log('metaDescription:', result.content.metaDescription)
  console.log('h1:', result.content.headings.h1.slice(0, 3))
  console.log('h2:', result.content.headings.h2.slice(0, 3))
  console.log('visibleText length:', result.content.visibleText.length)
  console.log('visibleText sample:', result.content.visibleText.slice(0, 150))
  console.log('candidateImages:', result.content.candidateImages)
  console.log('colors:', result.content.colors)
}
