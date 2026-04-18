const fs = require('fs');

const html = fs.readFileSync('psa-app/index.html', 'utf8');
const js = fs.readFileSync('psa-app/app.js', 'utf8');
const css = fs.readFileSync('psa-app/styles.css', 'utf8');

const requiredIds = [
  'themeToggleBtn','inspectionToggleBtn','inspectionZoomBtn','inspectionReadout',
  'listingUrl','itemId','title','price','shipping','sellerName','sellerScore','notes','compNotes','photoUrls',
  'frontCentering','backCentering','frontCenteringPct','backCenteringPct','corners','edges','surface','imageQuality','occlusion',
  'gradingFee','sellFees','psa9Value','psa10Value','rawResaleValue','targetProfit',
  'parseBtn','fetchStubBtn','loadDemoBtn','renderPhotosBtn','analyzeBtn','saveBtn','watchlistBtn','exportBtn','importFile',
  'photoGrid','summaryTitle','summaryMeta','summaryBuyIn','summaryTarget','backendStatus','backendStatusText',
  'probability','confidence','floorGrade','expectedProfit','psa9Net','psa10Net','maxBuyPrice','offerSuggestion',
  'probabilityMeter','confidenceMeter','recommendation','recommendationBadge','reasons','breakevenText',
  'historySort','historyFilter','watchlistSort','watchlistFilter','historyList','watchlistList'
];

const missing = requiredIds.filter(id => !html.includes(`id="${id}"`));
const checks = {
  hasThemeToggleHandler: js.includes("$('themeToggleBtn').addEventListener('click'"),
  hasInspectionToggleHandler: js.includes("$('inspectionToggleBtn').addEventListener('click'"),
  hasInspectionZoomHandler: js.includes("$('inspectionZoomBtn').addEventListener('click'"),
  hasFetchCall: js.includes("fetch('/api/ebay/fetch-listing'"),
  hasRecommendationBadge: js.includes('setRecommendationBadge('),
  hasInspectionCss: css.includes('.photo-grid.inspection-mode .photo-slot'),
  hasZoomCss: css.includes('.photo-grid.zoom-frame .photo-slot img'),
  hasThemeCss: css.includes('body[data-theme="modern"]')
};

console.log(JSON.stringify({ missing, checks }, null, 2));
