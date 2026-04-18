function $(id) {
  return document.getElementById(id);
}

function currency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value || 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseEbayUrl(url) {
  const patterns = [/\/itm\/(\d{9,})/i, /[?&]item=(\d{9,})/i, /[?&]itm=(\d{9,})/i];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('psaTheme', theme);
  const primary = $('themeToggleBtn');
  const mirror = $('themeToggleMirrorBtn');
  const label = theme === 'retro' ? 'Switch to Modern' : 'Switch to Retro';
  if (primary) primary.textContent = label;
  if (mirror) mirror.textContent = theme === 'retro' ? 'Toggle Theme' : 'Toggle Theme';
}

function setBackendStatus(mode, text) {
  const statusText = $('backendStatusText');
  const dot = $('backendStatus').querySelector('.status-dot');
  dot.className = 'status-dot ' + (mode === 'live' ? 'status-live' : mode === 'ready' ? 'status-ready' : 'status-idle');
  statusText.textContent = text;
}

function setRecommendationBadge(recommendation) {
  const badge = $('recommendationBadge');
  const map = {
    buy: { text: 'BUY SIGNAL', className: 'status-chip status-chip-buy' },
    maybe: { text: 'MAYBE SIGNAL', className: 'status-chip status-chip-maybe' },
    pass: { text: 'PASS SIGNAL', className: 'status-chip status-chip-pass' },
    waiting: { text: 'WAITING', className: 'status-chip status-chip-maybe' }
  };
  const next = map[recommendation] || map.waiting;
  badge.textContent = next.text;
  badge.className = next.className;
}

function updateSnapshot({ title, seller, itemId, buyIn, maxBuy }) {
  $('summaryTitle').textContent = title || 'No listing analyzed yet';
  $('summaryMeta').textContent = `${seller || 'Unknown seller'} • ${itemId || 'No item ID yet'}`;
  $('summaryBuyIn').textContent = currency(buyIn || 0);
  $('summaryTarget').textContent = `Target max buy: ${currency(maxBuy || 0)}`;
}

function defaultPhotoSlots() {
  return '<div class="photo-slot">Front image slot</div><div class="photo-slot">Back image slot</div><div class="photo-slot">Extra angle</div>';
}

function renderPhotos(urls = []) {
  const grid = $('photoGrid');
  grid.innerHTML = '';

  if (!urls.length) {
    grid.innerHTML = defaultPhotoSlots();
    return;
  }

  urls.slice(0, 6).forEach((url, index) => {
    const slot = document.createElement('div');
    slot.className = 'photo-slot';
    slot.innerHTML = `<img src="${url}" alt="Listing photo ${index + 1}" onerror="this.parentElement.innerHTML='Image failed to load';" />`;
    grid.appendChild(slot);
  });
}

function buildFetchStubPayload() {
  return {
    itemId: parseEbayUrl($('listingUrl').value.trim()),
    listingUrl: $('listingUrl').value.trim(),
    source: 'ebay',
    requestedAt: new Date().toISOString()
  };
}

async function normalizeListingUrl(listingUrl) {
  const response = await fetch('/api/ebay/normalize-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listingUrl })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to normalize listing URL');
  }

  return data.normalized;
}

async function fetchListingData(itemId, listingUrl) {
  const response = await fetch('/api/ebay/fetch-listing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, listingUrl })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to fetch listing');
  }

  return data;
}

async function analyzeImages(imageUrls, title, itemId) {
  const response = await fetch('/api/analyze/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrls, title, itemId })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to analyze images');
  }

  return data.vision;
}

async function analyzeListingData(listing, vision) {
  const response = await fetch('/api/analyze/listing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing, vision })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to analyze listing');
  }

  return data.analysis;
}

function applyAnalysis(result) {
  $('gradeRank').textContent = result.gradeRank;
  $('recommendation').textContent = result.recommendation.toUpperCase();
  $('confidence').textContent = `${result.confidence}%`;
  $('probability').textContent = `${result.probability}%`;
  $('expectedProfit').textContent = currency(result.expectedProfit);
  $('maxBuyPrice').textContent = currency(result.maxBuyPrice);
  $('offerSuggestion').textContent = result.offerSuggestion;
  $('riskFlags').textContent = result.riskFlags.join(' • ');
  $('probabilityMeter').style.width = `${result.probability}%`;
  $('confidenceMeter').style.width = `${result.confidence}%`;
  $('reasons').innerHTML = result.reasons.map(reason => `<li>${reason}</li>`).join('');
  $('breakevenText').textContent = result.summary;
  setRecommendationBadge(result.recommendation);
}

function simulateAnalysis(listing) {
  const probability = clamp(listing.itemId ? 74 : 58, 1, 99);
  const confidence = listing.photoUrls?.length ? 81 : 62;
  const maxBuyPrice = listing.price ? Math.max(0, listing.price - 28) : 150;
  const expectedProfit = listing.price ? Math.round((listing.price * 0.22) + 34) : 82;
  const recommendation = probability >= 72 ? 'buy' : probability >= 52 ? 'maybe' : 'pass';
  const gradeRank = recommendation === 'buy' ? 'A' : recommendation === 'maybe' ? 'B' : 'D';
  const riskFlags = [
    listing.photoUrls?.length ? 'photo count decent' : 'limited photos',
    'surface unknown',
    'final grade not guaranteed'
  ];

  return {
    recommendation,
    gradeRank,
    confidence,
    probability,
    maxBuyPrice,
    expectedProfit,
    offerSuggestion: listing.price && listing.price <= maxBuyPrice ? 'Buy at ask' : `Offer around ${currency(maxBuyPrice)}`,
    riskFlags,
    reasons: [
      'Listing metadata was pulled into the analyzer flow.',
      'Ranking is currently prototype logic until live photo scoring is connected.',
      'This interface is now centered on paste-link decision speed.'
    ],
    summary: `Prototype rank generated from fetched listing data. Final version should replace this with real automated photo + metadata scoring.`
  };
}

async function fetchAndAnalyzeListing() {
  const payload = buildFetchStubPayload();

  if (!payload.listingUrl) {
    $('intakeStatus').textContent = 'Paste an eBay link first.';
    setBackendStatus('idle', 'Waiting for listing URL.');
    return;
  }

  $('intakeStatus').textContent = 'Normalizing link, fetching listing, and generating rank...';
  setBackendStatus('ready', 'Starting live eBay analysis pipeline...');

  try {
    const normalized = await normalizeListingUrl(payload.listingUrl);
    setBackendStatus('ready', `URL normalized. Item ID: ${normalized.itemId || 'not found yet'}`);

    const fetchData = await fetchListingData(normalized.itemId, normalized.listingUrl);
    const listing = {
      itemId: fetchData.listing?.itemId || normalized.itemId,
      title: fetchData.listing?.title || 'Fetched listing',
      seller: fetchData.listing?.sellerName || 'Unknown seller',
      price: fetchData.listing?.price ?? 0,
      shipping: fetchData.listing?.shipping ?? 0,
      photoUrls: Array.isArray(fetchData.listing?.photoUrls) ? fetchData.listing.photoUrls : []
    };

    const vision = await analyzeImages(listing.photoUrls, listing.title, listing.itemId);
    const analysis = await analyzeListingData({
      itemId: listing.itemId,
      title: listing.title,
      price: listing.price,
      shipping: listing.shipping,
      sellerName: listing.seller,
      photoUrls: listing.photoUrls
    }, vision);

    updateSnapshot({
      title: listing.title,
      seller: listing.seller,
      itemId: listing.itemId,
      buyIn: (listing.price || 0) + (listing.shipping || 0),
      maxBuy: analysis.maxBuyPrice
    });
    renderPhotos(listing.photoUrls);
    applyAnalysis(analysis);

    $('intakeStatus').textContent = 'Live listing analyzed. Paste another eBay link to run again.';
    setBackendStatus(fetchData.mode === 'live-api' ? 'live' : 'ready', fetchData.message || 'Listing fetched and ranked.');
  } catch (error) {
    $('intakeStatus').textContent = 'Live analysis failed. Check the URL or API setup.';
    setBackendStatus('idle', `Fetch failed: ${error.message}`);
  }
}

function loadDemo() {
  $('listingUrl').value = 'https://www.ebay.com/itm/123456789012';
  fetchAndAnalyzeListing();
}

function init() {
  const savedTheme = localStorage.getItem('psaTheme') || 'retro';
  setTheme(savedTheme);

  $('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'GET', credentials: 'same-origin' });
    window.location.href = '/';
  });

  $('themeToggleBtn').addEventListener('click', () => {
    setTheme(document.body.getAttribute('data-theme') === 'retro' ? 'modern' : 'retro');
  });

  $('themeToggleMirrorBtn').addEventListener('click', () => {
    setTheme(document.body.getAttribute('data-theme') === 'retro' ? 'modern' : 'retro');
  });

  $('inspectionToggleBtn').addEventListener('click', () => {
    const grid = $('photoGrid');
    const enabled = grid.classList.toggle('inspection-mode');
    $('inspectionToggleBtn').textContent = enabled ? 'Inspection Mode On' : 'Inspection Mode Off';
    $('inspectionReadout').textContent = enabled
      ? 'Inspection mode is active. Use the framing guides to review edges, corners, and visible print defects.'
      : 'Photo review stays available, but it should support the automated result instead of driving the whole workflow.';
  });

  $('inspectionZoomBtn').addEventListener('click', () => {
    const grid = $('photoGrid');
    const enabled = grid.classList.toggle('zoom-frame');
    $('inspectionZoomBtn').textContent = enabled ? 'Zoom Reset' : 'Zoom Frame';
  });

  $('fetchStubBtn').addEventListener('click', fetchAndAnalyzeListing);
  $('analyzeListingBtn').addEventListener('click', fetchAndAnalyzeListing);
  $('loadDemoBtn').addEventListener('click', loadDemo);

  updateSnapshot({ title: 'No listing analyzed yet', seller: 'Awaiting URL', itemId: 'No item ID yet', buyIn: 0, maxBuy: 0 });
  setRecommendationBadge('waiting');
  setBackendStatus('idle', 'Locked and waiting for your private listing fetch and automated ranking.');
}

init();
