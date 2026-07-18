import { config } from 'dotenv'

import { extractPageContent } from '../integrations/web-extraction/index.ts'
import { generateBrandProfile } from '../integrations/brand-profile/index.ts'

config({ path: '.env.local' })

const urls = [
  'https://stripe.com',
  'https://news.ycombinator.com',
  'https://quotes.toscrape.com/js/',
]

for (const url of urls) {
  console.log('\n=== ' + url + ' ===')

  const extracted = await extractPageContent(url)
  if (!extracted.success) {
    console.log('EXTRACTION FAIL:', extracted.errorReason)
    continue
  }
  console.log(
    'extraction ok, source:',
    extracted.source,
    '| partial:',
    extracted.partial,
  )

  const start = Date.now()
  const result = await generateBrandProfile(extracted.content)
  const elapsed = Date.now() - start
  console.log('elapsed ms:', elapsed)

  if (!result.success) {
    console.log('LLM FAIL:', result.errorReason)
    continue
  }

  console.log('tokens usados:', result.usage)
  console.log('profile:', JSON.stringify(result.profile, null, 2))
}
