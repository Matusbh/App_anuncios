import { config } from 'dotenv'

import { extractPageContent } from '../integrations/web-extraction/index.ts'
import { generateBrandProfile } from '../integrations/brand-profile/index.ts'
import {
  generateAds,
  regenerateOneAd,
} from '../integrations/ad-generation/index.ts'

config({ path: '.env.local' })

const urls = ['https://stripe.com', 'https://quotes.toscrape.com/js/']

for (const url of urls) {
  console.log('\n=== ' + url + ' ===')

  const extracted = await extractPageContent(url)
  if (!extracted.success) {
    console.log('EXTRACTION FAIL:', extracted.errorReason)
    continue
  }

  const profileResult = await generateBrandProfile(extracted.content)
  if (!profileResult.success) {
    console.log('BRAND PROFILE FAIL:', profileResult.errorReason)
    continue
  }
  console.log('brand profile tokens:', profileResult.usage)

  const adsStart = Date.now()
  const adsResult = await generateAds(profileResult.profile)
  console.log('generateAds elapsed ms:', Date.now() - adsStart)

  if (!adsResult.success) {
    console.log('ADS FAIL:', adsResult.errorReason)
    continue
  }
  console.log('ads tokens:', adsResult.usage)
  console.log(`generated ${adsResult.ads.length} ad(s):`)
  console.log(JSON.stringify(adsResult.ads, null, 2))

  const firstAd = adsResult.ads[0]

  const regenStart = Date.now()
  const regenResult = await regenerateOneAd(profileResult.profile, firstAd)
  console.log('regenerateOneAd elapsed ms:', Date.now() - regenStart)

  if (!regenResult.success) {
    console.log('REGENERATE FAIL:', regenResult.errorReason)
    continue
  }
  console.log('regenerate tokens:', regenResult.usage)
  console.log('original creativeIdea:', firstAd.creativeIdea)
  console.log('regenerated creativeIdea:', regenResult.ad.creativeIdea)
  console.log('regenerated ad:', JSON.stringify(regenResult.ad, null, 2))
}
