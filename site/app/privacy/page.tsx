import LegalPage, {legalSettings} from '../legal-page';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Privacy | LumaNest TV', description: 'What LumaNest TV collects, why, and who processes it. No ad trackers or analytics scripts.', alternates: {canonical: '/privacy'}};

export default function Privacy() {
  const {support} = legalSettings();
  return <LegalPage path="/privacy" updated={['2026-10-23', 'October 23, 2026']} eyebrow="YOUR HOME, YOUR BUSINESS" title={<>Privacy <em>policy.</em></>} lead="We collect only what we need to sell, activate and renew your subscription, and to set up a free trial you ask for. This page explains what that is and where it goes.">
    <h2>What we collect at checkout</h2>
    <ul>
      <li><strong>Your email address</strong> (required) and <strong>your name</strong> (optional).</li>
      <li>Your order details: plan, number of screens, period, amount, PayPal order and payment references, and the order’s status.</li>
    </ul>
    <p>We use these to create or extend your subscription, set up your customer account, help you with support, and keep a record of payments.</p>
    <h2>What we collect for a free trial</h2>
    <ul>
      <li><strong>Your name and email address</strong> (both required), and the device you say you’ll watch on.</li>
      <li>A keyed hash of your network’s address (not the address itself). We use it to offer one trial per household network and to stop repeated or automated requests.</li>
      <li>Your request’s status, when it was made and decided, the site owner’s decision and any message sent to you with it.</li>
      <li>A hash of the secret part of your private status link, so we can recognise the link without keeping it. Anyone who has the link can see your request’s status and any message sent with a decision, but not your name or email address.</li>
      <li>Once a trial is approved, our subscription provider’s reference for your trial line and customer account, and when the trial ends.</li>
    </ul>
    <p>We use these to review your request, set up and end your trial, and help you with support. When your request arrives, the site owner is emailed a notice with your name, the device you chose, when you asked, and whether other recent requests came from the same home network or email address (never your email address, network address or status link), so they can review it; it is sent through Cloudflare and stays in the owner’s mailbox until they delete it. Nothing is shared with our subscription provider unless your request is approved (see Your customer account). Requests waiting for review are kept until they are decided. Declined requests, and requests our team closes by hand, are deleted 30 days after that decision; completed trials are deleted 180 days after they end. Both are removed by routine clean-up, and the status link then stops working. This clean-up covers this website’s records; see Your customer account for what our subscription provider keeps.</p>
    <h2>Payments</h2>
    <p>Payments are handled by PayPal. You pay on PayPal’s own pages, so this website never sees your card or bank details. We receive the payment confirmation and references we need to activate your order. If you choose auto-renew, PayPal also tells us about each scheduled payment and if the agreement is cancelled.</p>
    <h2>Your customer account</h2>
    <p>To activate a new subscription, we send your email address and name to our subscription management provider, which creates your line and emails you an invitation to your customer hub. For a free trial, we send them only after the site owner approves your request; the provider then links your trial line to a customer account and emails you the same invitation. That customer account, with your email address and name, stays with our subscription provider after the trial ends, so you can buy a plan with it later; email support if you’d like it deleted. Your customer account password is set and kept in the customer hub, not on this website.</p>
    <h2>Your line login</h2>
    <p>When you sign in to the web player or the renewal page, your line username and password are used only to sign you in and are checked with our subscription provider. They are kept in an encrypted, HttpOnly session cookie in your browser, not stored in our database. If you set up auto-renew, we store a one-way hash of your line login to link the agreement to your line.</p>
    <h2>Admin access</h2>
    <p>The site owner can view orders, subscription records and free trial requests in a protected admin console, to fulfil orders, approve or decline trial requests, and answer support requests.</p>
    <h2>Security and abuse prevention</h2>
    <p>To limit repeated sign-in, checkout and free trial requests, and checks of a trial’s status, we keep short-lived rate-limit records. They are stored as hashes, not as your IP address or your login.</p>
    <h2>Cookies and browser storage</h2>
    <ul>
      <li>We only use cookies needed for signing in: the web player, renewal and admin sessions.</li>
      <li>Your browser’s local storage keeps your web player favorites and whether you dismissed the “install app” prompt. This stays on your device.</li>
      <li>We don’t use advertising trackers or analytics scripts.</li>
      <li>When you play a trailer, YouTube’s embedded player can store YouTube’s own data in your browser, such as local storage, and YouTube may set its own cookies, under YouTube’s policies (see Other services).</li>
    </ul>
    <h2>Other services</h2>
    <ul>
      <li>The site runs on Cloudflare, which processes requests to deliver it.</li>
      <li>Fonts are hosted on this website and delivered by Cloudflare. Loading them does not send a request to Google Fonts.</li>
      <li>In the web player, posters hosted by TMDB are loaded by your browser directly from TMDB’s image service (image.tmdb.org): those of titles matched to TMDB’s movie and series lists, and any poster your line’s catalogue links there. TMDB then receives your IP address and browser details with those image requests, as any website you load an image from does; no referrer is sent. Every other poster is passed through this website, so other poster hosts never see your address.</li>
      <li>English subtitles for movies and episodes come from OpenSubtitles.com through this website. When a movie or episode starts, the web player asks this website which subtitles exist, and this website looks them up at OpenSubtitles by the title’s TMDB number (with the season and episode). For a title without a TMDB number, this website first sends its name and year to TMDB to find the number. The subtitle file is downloaded from OpenSubtitles and passed to you only when subtitles are shown. OpenSubtitles and TMDB never receive your IP address or anything about you. We don’t keep subtitle files; your browser may keep one for up to 7 days.</li>
      <li>When you choose Trailer, the trailer plays in YouTube’s embedded player (privacy-enhanced mode, youtube-nocookie.com), which is a YouTube API Service. YouTube (Google) then receives your IP address, browser details, which video you watch and playback data from its player, and the <a href="https://www.youtube.com/t/terms" rel="noopener noreferrer">YouTube Terms of Service</a> and <a href="https://policies.google.com/privacy" rel="noopener noreferrer">Google Privacy Policy</a> apply. YouTube serves the trailer and decides what its player shows, including any ads. Nothing is loaded from YouTube until you choose Trailer. This website finds the trailer with TMDB without sending anything about you.</li>
      <li>The Tuner apps for Samsung and LG TVs play trailers in a page on this website (lumanest.tv/embed/trailer) that holds the same YouTube embedded player. The page’s address carries only the trailer’s YouTube video ID; the page sets no cookies of its own, and this website stores nothing from it and writes no log of its own (Cloudflare processes the request, as for every page). YouTube’s player script, loaded from youtube.com, can set YouTube’s cookies (some kept for about 180 days), and YouTube (Google) receives the TV’s IP address, browser details and which video is watched when the player loads, and playback data while it plays; YouTube decides what the player shows, including any ads (when it shows one, Google’s ad servers and any services measuring it receive the TV’s IP address too), under the YouTube Terms of Service and the Google Privacy Policy linked above. Opened on its own in a browser, the page loads nothing from YouTube.</li>
      <li>The Tuner app for Android TV, Google TV and Fire TV (1.8.1 and later, including the version downloaded from this website) plays trailers inside the app in the same YouTube embedded player, in a page the app writes itself; nothing about it passes through this website. YouTube (Google) receives the TV’s IP address, device details, which video plays and playback data, and decides what the player shows, including any ads (when it shows one, Google’s ad servers and any services measuring it receive the TV’s IP address too). The <a href="https://tunertv.app/privacy">Tuner privacy policy</a> describes the Tuner apps in full.</li>
      <li>To prevent abuse, requests for subtitles and trailers are counted per network address for one minute; the address is not stored. Subtitle downloads are also counted per day: we keep a keyed hash of your network’s address (not the address itself) with its number of downloads for the current UTC day. It is kept for that day and the next, then removed by routine clean-up.</li>
    </ul>
    <h2>Your choices</h2>
    <p>You can ask us what we hold about you, or ask us to correct or delete it (including a free trial request), by emailing support. We may need to keep payment records where the law requires it.</p>
    <p className="legal-contact">Privacy questions? Email <a href={'mailto:' + support}>{support}</a>.</p>
  </LegalPage>;
}
