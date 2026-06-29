/**
 * app.js
 * Core logic for the Pipeline Defect Comparison Visualizer.
 * Includes data parsing, weld alignment, stretch-and-squeeze, canvas rendering, and UI synchronization.
 */

(function () {
  // Global Application State
  const state = {
    diameter: 762,             // Outside Diameter (mm)
    thickness: 12.7,           // Wall Thickness (mm)
    nominalJointLength: 12,    // Nominal joint length (m)
    tolerance: 10,             // Alignment tolerance (%)
    matchDistance: 1.0,        // Defect match max distance (m)
    matchClock: 60,            // Defect match max clock difference (minutes)
    
    // Raw parsed sheet data (arrays of objects)
    prevRawData: null,
    latRawData: null,
    prevFileName: '',
    latFileName: '',
    
    // Structured data
    prevWelds: [],
    prevDefects: [],
    prevLandmarks: [],
    latWelds: [],
    latDefects: [],
    latLandmarks: [],
    
    // Column Mappings for each file
    prevMapping: null,
    latMapping: null,
    currentMappingTarget: 'prev', // 'prev' or 'lat'
    
    // Alignment results
    scaleFactor: 1.0,
    weldMatches: [],           // [{idxPrev, idxLat, type: 'match'|'skip_prev'|'skip_lat'}]
    alignedPrevDefects: [],    // previous defects with distance mapped to Latest coordinates
    alignedPrevLandmarks: [],  // previous landmarks with distance mapped to Latest coordinates
    alignedPrevWelds: [],      // previous welds with distance mapped to Latest coordinates
    matchedDefects: [],        // [{prev, lat, growth, spatialDist, status: 'matched'}]
    unmatchedPrev: [],         // defects in Prev not matched to Lat (repaired)
    unmatchedLat: [],          // defects in Lat not matched to Prev (new)
    
    // Visualization State
    zoom: 15,                  // pixels per meter
    panOffset: 0,              // in meters from start
    maxDistance: 300,          // total pipeline length represented (m)
    hoverDist: null,           // Aligned distance currently hovered (m)
    hoverClockRatio: null,     // Clock ratio currently hovered (0 to 1)
    selectedDefectId: null,    // Selected defect ID for highlight
    colorMode: 'depth',        // 'depth', 'growth', 'status'
    showWelds: true,
    showLinks: true,
    defectCurrentPage: 1,      // Current page for defects table
    weldCurrentPage: 1,        // Current page for welds table
    pageSize: 50,              // Number of rows per page
    shouldJumpToPage: false,   // Flag to trigger auto page-jump when focusing a defect
    depthWeight: 0.01,         // Depth Influence Coefficient (m/%)
    weldDistWeight: 1.0,       // U/S Weld Distance Influence Weight (dimensionless multiplier)
    needsRecalculate: false    // Track if alignment parameters are out-of-sync
  };

  // DOM Elements
  const els = {
    inputOD: document.getElementById('inputOD'),
    inputWT: document.getElementById('inputWT'),
    inputJointLength: document.getElementById('inputJointLength'),
    inputTolerance: document.getElementById('inputTolerance'),
    inputMatchDist: document.getElementById('inputMatchDist'),
    inputMatchClock: document.getElementById('inputMatchClock'),
    
    filePrev: document.getElementById('filePrev'),
    fileLat: document.getElementById('fileLat'),
    namePrev: document.getElementById('namePrev'),
    nameLat: document.getElementById('nameLat'),
    statusPrev: document.getElementById('statusPrev'),
    statusLat: document.getElementById('statusLat'),
    
    uploadPrevCard: document.getElementById('uploadPrevCard'),
    uploadLatCard: document.getElementById('uploadLatCard'),
    
    btnLoadDemo: document.getElementById('btnLoadDemo'),
    btnReset: document.getElementById('btnReset'),
    btnDownloadTemplate: document.getElementById('btnDownloadTemplate'),
    btnThemeToggle: document.getElementById('btnThemeToggle'),
    
    statMatched: document.getElementById('statMatched'),
    statNew: document.getElementById('statNew'),
    statRepaired: document.getElementById('statRepaired'),
    statMaxGrowth: document.getElementById('statMaxGrowth'),
    
    pipelineCircLabel: document.getElementById('pipelineCircLabel'),
    btnZoomIn: document.getElementById('btnZoomIn'),
    btnZoomOut: document.getElementById('btnZoomOut'),
    btnZoomFit: document.getElementById('btnZoomFit'),
    chkShowWelds: document.getElementById('chkShowWelds'),
    chkShowLinks: document.getElementById('chkShowLinks'),
    selColorMode: document.getElementById('selColorMode'),
    
    canvasPrev: document.getElementById('canvasPrev'),
    canvasLat: document.getElementById('canvasLat'),
    canvasMinimap: document.getElementById('canvasMinimap'),
    zoomLevelDisplay: document.getElementById('zoomLevelDisplay'),
    
    tableSearch: document.getElementById('tableSearch'),
    filterStatus: document.getElementById('filterStatus'),
    defectTableBody: document.getElementById('defectTableBody'),
    
    // Modal elements
    mappingModal: document.getElementById('mappingModal'),
    mappingModalTitle: document.getElementById('mappingModalTitle'),
    btnModalClose: document.getElementById('btnModalClose'),
    btnCancelMapping: document.getElementById('btnCancelMapping'),
    btnApplyMapping: document.getElementById('btnApplyMapping'),
    previewTable: document.getElementById('previewTable'),
    chkAutoWeldGen: document.getElementById('chkAutoWeldGen'),
    
    mapDistance: document.getElementById('mapDistance'),
    mapType: document.getElementById('mapType'),
    mapClock: document.getElementById('mapClock'),
    mapDepth: document.getElementById('mapDepth'),
    mapLength: document.getElementById('mapLength'),
    mapWidth: document.getElementById('mapWidth'),
    mapJointId: document.getElementById('mapJointId'),
    mapWT: document.getElementById('mapWT'),
    mapJointLength: document.getElementById('mapJointLength'),
    mapUsWeldDist: document.getElementById('mapUsWeldDist'),
    
    floatTooltip: document.getElementById('floatTooltip'),
    testRunnerBadge: document.getElementById('testRunnerBadge'),
    inputDepthWeight: document.getElementById('inputDepthWeight'),
    inputWeldDistWeight: document.getElementById('inputWeldDistWeight'),
    btnRecalculate: document.getElementById('btnRecalculate'),

    // Tabs & Weld table selectors
    tabDefects: document.getElementById('tabDefects'),
    tabWelds: document.getElementById('tabWelds'),
    paneDefects: document.getElementById('paneDefects'),
    paneWelds: document.getElementById('paneWelds'),
    weldSearch: document.getElementById('weldSearch'),
    filterWeldStatus: document.getElementById('filterWeldStatus'),
    weldTableBody: document.getElementById('weldTableBody')
  };

  // Canvas context holders
  let ctxPrev = null;
  let ctxLat = null;
  let ctxMinimap = null;

  // Initialize App
  function init() {
    initTheme();
    setupEventListeners();
    setupCanvasContexts();
    updatePipelineCircumferenceLabel();
    resizeCanvases();
  }

  function setupCanvasContexts() {
    ctxPrev = els.canvasPrev.getContext('2d');
    ctxLat = els.canvasLat.getContext('2d');
    ctxMinimap = els.canvasMinimap.getContext('2d');
  }

  function updatePipelineCircumferenceLabel() {
    state.diameter = parseFloat(els.inputOD.value) || 762;
    state.thickness = parseFloat(els.inputWT.value) || 12.7;
    const circ = (Math.PI * state.diameter) / 1000; // in meters
    els.pipelineCircLabel.textContent = `Circumference: ${circ.toFixed(3)} m (πD)`;
  }

  // --- Clock Orientation Parsing & Math ---
  /**
   * Converts clock format "HH:MM" (or decimal "6.5") to a ratio [0, 1]
   * representing position on the unrolled pipe.
   * 12:00 = 0.0, 03:00 = 0.25, 06:00 = 0.5, 09:00 = 0.75, 12:00 = 1.0
   */
  function parseClockToRatio(clockVal) {
    if (clockVal === undefined || clockVal === null || clockVal === '') return 0;
    
    let hours = 0;
    let minutes = 0;

    const str = clockVal.toString().trim();
    if (str.includes(':')) {
      const parts = str.split(':');
      hours = parseInt(parts[0], 10) || 0;
      minutes = parseInt(parts[1], 10) || 0;
    } else {
      const decimalVal = parseFloat(str);
      if (!isNaN(decimalVal)) {
        hours = Math.floor(decimalVal);
        minutes = Math.round((decimalVal - hours) * 60);
      }
    }

    // Convert to a 12-hour basis
    hours = hours % 12;
    if (hours < 0) hours += 12;
    minutes = minutes % 60;
    if (minutes < 0) minutes += 60;

    const totalMinutes = hours * 60 + minutes;
    return totalMinutes / 720; // 720 minutes in 12 hours
  }

  function ratioToClockStr(ratio) {
    let totalMinutes = Math.round(ratio * 720) % 720;
    if (totalMinutes < 0) totalMinutes += 720;
    let hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) hours = 12; // 00:00 is represented as 12:00
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  // Calculate circular differences between clock ratios
  function getClockRatioDiff(r1, r2) {
    const d = Math.abs(r1 - r2);
    return Math.min(d, 1 - d);
  }

  // Binary search helper to find the index of the first element in a sorted array where keySelector(element) >= targetValue
  function binarySearchFirstIndex(array, keySelector, targetValue) {
    let low = 0;
    let high = array.length - 1;
    let result = array.length;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const val = keySelector(array[mid]);
      if (val >= targetValue) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return result;
  }

  // Helper to calculate and fill joint lengths for a list of welds
  function fillWeldJointLengths(welds, mappedJointLengthField) {
    welds.sort((a, b) => a.distance - b.distance);
    
    welds.forEach((w, i) => {
      let val = null;
      if (mappedJointLengthField && mappedJointLengthField !== '__none__' && w.jointLength !== undefined && w.jointLength !== null) {
        val = parseFloat(w.jointLength);
      }
      
      if (val === null || isNaN(val) || val <= 0) {
        // Fall back to distance to next weld
        if (i < welds.length - 1) {
          val = welds[i+1].distance - w.distance;
        } else if (i > 0) {
          val = welds[i-1].jointLength;
        } else {
          val = state.nominalJointLength;
        }
      }
      
      w.jointLength = parseFloat(val.toFixed(3));
    });
  }

  // --- Weld Alignment: Needleman-Wunsch on Joint Length Sequences ---
  /**
   * Aligns two lists of girth welds using dynamic programming on joint lengths.
   * Uses local neighborhoods (size 3) for barcode matching to prevent drift and mismatches.
   */
  function alignWelds(weldsPrev, weldsLat) {
    const N = weldsPrev.length;
    const M = weldsLat.length;
    
    if (N === 0 || M === 0) {
      return { path: [], scale: 1.0 };
    }

    // Ensure joint lengths are computed for both lists
    fillWeldJointLengths(weldsPrev, state.prevMapping ? state.prevMapping.mappedJointLength : '__none__');
    fillWeldJointLengths(weldsLat, state.latMapping ? state.latMapping.mappedJointLength : '__none__');

    const prevLengths = weldsPrev.map(w => w.jointLength);
    const latLengths = weldsLat.map(w => w.jointLength);

    // Tolerance limit in meters (e.g. 1.2m for 10% of 12m)
    const toleranceM = (state.tolerance / 100) * state.nominalJointLength;
    const skipPenalty = state.nominalJointLength * 0.8;

    // DP Table initialization
    const dp = Array.from({ length: N + 1 }, () => Array(M + 1).fill(Infinity));
    const parent = Array.from({ length: N + 1 }, () => Array(M + 1).fill(null));

    dp[0][0] = 0;

    // Boundaries: representing initial/terminal gaps (skips)
    for (let i = 1; i <= N; i++) {
      dp[i][0] = i * skipPenalty;
      parent[i][0] = { i: i - 1, j: 0, type: 'skip_prev' };
    }
    for (let j = 1; j <= M; j++) {
      dp[0][j] = j * skipPenalty;
      parent[0][j] = { i: 0, j: j - 1, type: 'skip_lat' };
    }

    // Fill table
    for (let i = 1; i <= N; i++) {
      for (let j = 1; j <= M; j++) {
        // Option 1: Match Previous Weld i-1 and Latest Weld j-1
        const lenP = prevLengths[i - 1];
        const lenL = latLengths[j - 1];
        const diff = Math.abs(lenP - lenL);

        let matchCost = Infinity;
        if (diff <= toleranceM) {
          // Compare neighborhood of size 3 to uniquely identify barcode pattern and prevent drift
          let costSum = diff;
          let weightSum = 1.0;

          if (i > 1 && j > 1) {
            costSum += 0.5 * Math.abs(prevLengths[i - 2] - latLengths[j - 2]);
            weightSum += 0.5;
          }
          if (i < N && j < M) {
            costSum += 0.5 * Math.abs(prevLengths[i] - latLengths[j]);
            weightSum += 0.5;
          }

          matchCost = dp[i - 1][j - 1] + (costSum / weightSum);
        }

        // Option 2: Skip Previous Weld
        const skipPrevCost = dp[i - 1][j] + skipPenalty;

        // Option 3: Skip Latest Weld
        const skipLatCost = dp[i][j - 1] + skipPenalty;

        // Find minimum cost path cell
        if (matchCost <= skipPrevCost && matchCost <= skipLatCost) {
          dp[i][j] = matchCost;
          parent[i][j] = { i: i - 1, j: j - 1, type: 'match' };
        } else if (skipPrevCost <= skipLatCost) {
          dp[i][j] = skipPrevCost;
          parent[i][j] = { i: i - 1, j, type: 'skip_prev' };
        } else {
          dp[i][j] = skipLatCost;
          parent[i][j] = { i, j: j - 1, type: 'skip_lat' };
        }
      }
    }

    // Backtrack to find alignment path
    let curI = N;
    let curJ = M;
    const path = [];

    while (curI > 0 || curJ > 0) {
      const move = parent[curI][curJ];
      if (!move) break;

      if (move.type === 'match') {
        path.push({ idxPrev: curI - 1, idxLat: curJ - 1, type: 'match' });
        curI--;
        curJ--;
      } else if (move.type === 'skip_prev') {
        path.push({ idxPrev: curI - 1, idxLat: null, type: 'skip_prev' });
        curI--;
      } else {
        path.push({ idxPrev: null, idxLat: curJ - 1, type: 'skip_lat' });
        curJ--;
      }
    }

    path.reverse();

    // Calculate actual odometer scale factor from the matched welds
    let scale = 1.0;
    const matchedPairs = path.filter(m => m.type === 'match');
    if (matchedPairs.length >= 2) {
      matchedPairs.sort((a, b) => a.idxPrev - b.idxPrev);
      const first = matchedPairs[0];
      const last = matchedPairs[matchedPairs.length - 1];
      const prevSpan = weldsPrev[last.idxPrev].distance - weldsPrev[first.idxPrev].distance;
      const latSpan = weldsLat[last.idxLat].distance - weldsLat[first.idxLat].distance;
      if (prevSpan > 0 && latSpan > 0) {
        scale = latSpan / prevSpan;
      }
    } else {
      const prevDistSpan = weldsPrev[N - 1].distance - weldsPrev[0].distance;
      const latDistSpan = weldsLat[M - 1].distance - weldsLat[0].distance;
      if (prevDistSpan > 0 && latDistSpan > 0) {
        scale = latDistSpan / prevDistSpan;
      }
    }

    return { path, scale };
  }

  // --- Stretch-and-Squeeze Coordinate Mapping ---
  /**
   * Maps a distance in the Previous ILI coordinate system to the Latest run.
   * Uses local joint scaling between consecutive matched welds.
   */
  function mapPrevDistanceToLat(distance, weldsPrev, weldsLat, weldMatches, overallScale) {
    if (weldMatches.length === 0) {
      return distance * overallScale;
    }

    // Filter down to matched pairs
    const matchedPairs = weldMatches.filter(m => m.type === 'match');
    if (matchedPairs.length === 0) {
      return distance * overallScale;
    }

    // Sort by previous distance to ensure ordering
    matchedPairs.sort((a, b) => weldsPrev[a.idxPrev].distance - weldsPrev[b.idxPrev].distance);

    // 1. Extrapolate before first matched weld
    const firstMatch = matchedPairs[0];
    const wPrevFirst = weldsPrev[firstMatch.idxPrev].distance;
    const wLatFirst = weldsLat[firstMatch.idxLat].distance;
    if (distance < wPrevFirst) {
      return wLatFirst + (distance - wPrevFirst) * overallScale;
    }

    // 2. Extrapolate after last matched weld
    const lastMatch = matchedPairs[matchedPairs.length - 1];
    const wPrevLast = weldsPrev[lastMatch.idxPrev].distance;
    const wLatLast = weldsLat[lastMatch.idxLat].distance;
    if (distance >= wPrevLast) {
      return wLatLast + (distance - wPrevLast) * overallScale;
    }

    // 3. Interpolate (Stretch & Squeeze) between enclosing matched welds
    for (let k = 0; k < matchedPairs.length - 1; k++) {
      const matchA = matchedPairs[k];
      const matchB = matchedPairs[k + 1];

      const pA = weldsPrev[matchA.idxPrev].distance;
      const pB = weldsPrev[matchB.idxPrev].distance;
      const lA = weldsLat[matchA.idxLat].distance;
      const lB = weldsLat[matchB.idxLat].distance;

      if (distance >= pA && distance <= pB) {
        const ratio = (distance - pA) / (pB - pA);
        return lA + ratio * (lB - lA);
      }
    }

    return distance * overallScale;
  }

  // --- Defect Matching Engine ---
  /**
   * Core engine matching aligned defects based on spatial 2D proximity.
   * Spatial distance incorporates axial (m) and circumferential (m) offsets.
   */
  function matchDefects(prevDefects, latDefects) {
    const matched = [];
    const unmatchedP = [...prevDefects];
    const unmatchedL = [...latDefects];

    // Compute circular physical circumferences
    const pipeCircumferenceM = (Math.PI * state.diameter) / 1000; // in meters

    // Construct scoring matrix for all combinations
    const pairs = [];
    for (let i = 0; i < unmatchedP.length; i++) {
      const p = unmatchedP[i];
      for (let j = 0; j < unmatchedL.length; j++) {
        const l = unmatchedL[j];

        // Axial difference (meters)
        const dX = Math.abs(p.alignedDistance - l.distance);

        // Clock ratio difference
        const dClockRatio = getClockRatioDiff(p.clockRatio, l.clockRatio);
        // Circumferential difference (meters)
        const dY = dClockRatio * pipeCircumferenceM;

        // Check if limits exceeded
        const clockDiffMin = dClockRatio * 720;
        if (dX <= state.matchDistance && clockDiffMin <= state.matchClock) {
          // Spatial 2D Distance
          const dist2D = Math.sqrt(dX * dX + dY * dY);
          // Composite Score (incorporating depth consistency & local girth weld distance similarity)
          const depthDiff = Math.abs(p.depth - l.depth);
          const weldDistDiff = Math.abs(p.usWeldDist - l.usWeldDist);
          const compositeScore = dist2D + (state.depthWeight * depthDiff) + (state.weldDistWeight * weldDistDiff);
          pairs.push({ prevIdx: i, latIdx: j, dist: compositeScore, p, l });
        }
      }
    }

    // Sort pairs by spatial 2D distance (greedy bipartite matching)
    pairs.sort((a, b) => a.dist - b.dist);

    const prevMatchedFlags = new Array(unmatchedP.length).fill(false);
    const latMatchedFlags = new Array(unmatchedL.length).fill(false);

    for (const pair of pairs) {
      if (prevMatchedFlags[pair.prevIdx] || latMatchedFlags[pair.latIdx]) {
        continue; // Already matched
      }

      prevMatchedFlags[pair.prevIdx] = true;
      latMatchedFlags[pair.latIdx] = true;

      const depthGrowth = pair.l.depth - pair.p.depth;

      matched.push({
        prev: pair.p,
        lat: pair.l,
        growth: depthGrowth,
        spatialDist: pair.dist,
        status: 'matched'
      });
    }

    // Extract unmatched
    const finalUnmatchedP = unmatchedP.filter((_, idx) => !prevMatchedFlags[idx]);
    const finalUnmatchedL = unmatchedL.filter((_, idx) => !latMatchedFlags[idx]);

    return { matched, unmatchedPrev: finalUnmatchedP, unmatchedLat: finalUnmatchedL };
  }

  function markOutOfSync() {
    state.needsRecalculate = true;
    if (state.prevDefects.length > 0 && state.latDefects.length > 0) {
      els.btnRecalculate.classList.add('btn-warning-pulse');
      els.btnRecalculate.disabled = false;
      els.btnRecalculate.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right: 0.25rem;">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
        Recalculate Alignment *
      `;
    }
  }

  // --- Process & Align Uploaded/Generated Data ---
  function processDataAndAlign() {
    if (state.prevWelds.length === 0 || state.latWelds.length === 0) return;

    // 1. Run Weld Alignment DP
    const alignmentResult = alignWelds(state.prevWelds, state.latWelds);
    state.weldMatches = alignmentResult.path;
    state.scaleFactor = alignmentResult.scale;

    // 2. Perform Stretch-and-Squeeze on Previous Defects
    state.alignedPrevDefects = state.prevDefects.map(def => {
      const alignedD = mapPrevDistanceToLat(
        def.distance,
        state.prevWelds,
        state.latWelds,
        state.weldMatches,
        state.scaleFactor
      );
      return {
        ...def,
        alignedDistance: parseFloat(alignedD.toFixed(3))
      };
    });

    // 2b. Perform Stretch-and-Squeeze on Previous Landmarks
    state.alignedPrevLandmarks = state.prevLandmarks.map(lm => {
      const alignedD = mapPrevDistanceToLat(
        lm.distance,
        state.prevWelds,
        state.latWelds,
        state.weldMatches,
        state.scaleFactor
      );
      return {
        ...lm,
        alignedDistance: parseFloat(alignedD.toFixed(3))
      };
    });

    // 2c. Perform Stretch-and-Squeeze on Previous Welds
    state.alignedPrevWelds = state.prevWelds.map(weld => {
      const match = state.weldMatches.find(m => m.type === 'match' && m.idxPrev === state.prevWelds.indexOf(weld));
      let alignedD;
      if (match) {
        alignedD = state.latWelds[match.idxLat].distance;
      } else {
        alignedD = mapPrevDistanceToLat(
          weld.distance,
          state.prevWelds,
          state.latWelds,
          state.weldMatches,
          state.scaleFactor
        );
      }
      return {
        ...weld,
        alignedDistance: parseFloat(alignedD.toFixed(3))
      };
    });

    // 3. Compute Upstream Weld Distances for all datasets
    computeUsWeldDistances('prev');
    computeUsWeldDistances('lat');
    
    // For alignedPrevDefects, compute usWeldDistAligned using latWelds!
    state.alignedPrevDefects.forEach(def => {
      let upstreamWeld = null;
      for (let i = state.latWelds.length - 1; i >= 0; i--) {
        if (state.latWelds[i].distance <= def.alignedDistance) {
          upstreamWeld = state.latWelds[i];
          break;
        }
      }
      
      def.usWeldDistAligned = upstreamWeld ? parseFloat((def.alignedDistance - upstreamWeld.distance).toFixed(3)) : def.alignedDistance;
      
      const origDef = state.prevDefects.find(d => d.id === def.id);
      def.usWeldDist = origDef ? origDef.usWeldDist : null;
    });

    // 4. Match Defects between runs
    const matchResult = matchDefects(state.alignedPrevDefects, state.latDefects);
    state.matchedDefects = matchResult.matched;
    state.matchedDefects.sort((a, b) => a.lat.distance - b.lat.distance); // Sort by latest distance for optimized binary search rendering!
    state.unmatchedPrev = matchResult.unmatchedPrev;
    state.unmatchedLat = matchResult.unmatchedLat;

    // Update stats
    updateStatsDashboard();

    // Set map total length based on latest run
    const latMaxDist = state.latWelds.length > 0 ? state.latWelds[state.latWelds.length - 1].distance : 0;
    const latMaxDef = state.latDefects.length > 0 ? state.latDefects[state.latDefects.length - 1].distance : 0;
    state.maxDistance = Math.max(latMaxDist, latMaxDef, 100);

    // Refresh rendering and tables
    renderAll();
    fillComparisonTable();
    fillWeldAlignmentTable();

    // Reset recalculate button state
    state.needsRecalculate = false;
    if (els.btnRecalculate) {
      els.btnRecalculate.classList.remove('btn-warning-pulse');
      els.btnRecalculate.disabled = !(state.prevDefects.length > 0 && state.latDefects.length > 0);
      els.btnRecalculate.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right: 0.25rem;">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
        Recalculate Alignment
      `;
    }
  }

  // Calculates or reads distance to upstream girth weld for each defect
  function computeUsWeldDistances(runType) {
    const welds = runType === 'prev' ? state.prevWelds : state.latWelds;
    const defects = runType === 'prev' ? state.prevDefects : state.latDefects;
    const mappedUsWeldDist = runType === 'prev' ? (state.prevMapping ? state.prevMapping.mappedUsWeldDist : '__none__') : (state.latMapping ? state.latMapping.mappedUsWeldDist : '__none__');

    defects.forEach(def => {
      let val = null;
      if (mappedUsWeldDist !== '__none__' && def.usWeldDist !== undefined && def.usWeldDist !== null && !isNaN(def.usWeldDist)) {
        val = def.usWeldDist;
      }

      if (val === null || isNaN(val) || val < 0) {
        let upstreamWeld = null;
        for (let i = welds.length - 1; i >= 0; i--) {
          if (welds[i].distance <= def.distance) {
            upstreamWeld = welds[i];
            break;
          }
        }
        
        if (upstreamWeld) {
          val = def.distance - upstreamWeld.distance;
        } else {
          val = def.distance;
        }
      }

      def.usWeldDist = parseFloat(val.toFixed(3));
    });
  }

  // Generate synthetic welds if a file only contains defects
  function ensureGirthWelds(fileType) {
    const nominal = state.nominalJointLength;
    const targetWelds = fileType === 'prev' ? state.prevWelds : state.latWelds;
    const targetDefects = fileType === 'prev' ? state.prevDefects : state.latDefects;

    if (targetWelds.length > 0) return; // Welds exist

    // Find max distance in defects
    const maxDefectDist = targetDefects.reduce((max, d) => Math.max(max, d.distance), 0);
    const totalLength = Math.max(maxDefectDist + nominal, 100);

    const generated = [];
    let currentDist = 0;
    let index = 0;
    while (currentDist <= totalLength) {
      generated.push({
        id: `GW-S-${index}`,
        distance: parseFloat(currentDist.toFixed(3)),
        type: 'Weld'
      });
      // Add a slight random noise to simulate odometer changes
      currentDist += nominal + (Math.random() - 0.5) * 0.05;
      index++;
    }

    if (fileType === 'prev') {
      state.prevWelds = generated;
    } else {
      state.latWelds = generated;
    }
  }

  // --- Stats Dashboard Updates ---
  function updateStatsDashboard() {
    const totalMatched = state.matchedDefects.length;
    const totalNew = state.unmatchedLat.length;
    const totalRepaired = state.unmatchedPrev.length;

    els.statMatched.textContent = totalMatched;
    els.statNew.textContent = totalNew;
    els.statRepaired.textContent = totalRepaired;

    let maxGrowth = 0;
    state.matchedDefects.forEach(pair => {
      if (pair.growth > maxGrowth) {
        maxGrowth = pair.growth;
      }
    });

    els.statMaxGrowth.textContent = maxGrowth > 0 ? `+${maxGrowth.toFixed(1)}%` : '0.0%';
  }

  // Helper to scan for actual header rows (skips title merges at the top)
  function preprocessRawRows(rawRows) {
    if (!rawRows || rawRows.length === 0) return [];

    const keywords = ['distance', 'joint', 'length', 'feature', 'type', 'orientation', 'clock', 'depth', 'thickness', 'width', 'comment', 'abs', 'odometer', 'axial', 'location'];
    let bestHeaderIdx = 0;
    let maxMatches = -1;

    // Scan the first 15 rows for the headers
    const scanLimit = Math.min(rawRows.length, 15);
    for (let r = 0; r < scanLimit; r++) {
      const row = rawRows[r];
      if (!row || !Array.isArray(row)) continue;

      let matches = 0;
      row.forEach(cell => {
        if (cell === undefined || cell === null) return;
        const cellStr = cell.toString().toLowerCase();
        keywords.forEach(kw => {
          if (cellStr.includes(kw)) {
            matches++;
          }
        });
      });

      if (matches > maxMatches) {
        maxMatches = matches;
        bestHeaderIdx = r;
      }
    }

    // Get cleaned headers
    const rawHeaders = rawRows[bestHeaderIdx] || [];
    const headers = rawHeaders.map((h, colIdx) => {
      if (h === undefined || h === null || h.toString().trim() === '') {
        return `Column_${colIdx + 1}`;
      }
      return h.toString().trim();
    });

    const parsedObjects = [];
    for (let r = bestHeaderIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || !Array.isArray(row)) continue;
      
      // Skip empty rows
      const hasContent = row.some(cell => cell !== undefined && cell !== null && cell.toString().trim() !== '');
      if (!hasContent) continue;

      const obj = {};
      headers.forEach((h, colIdx) => {
        obj[h] = row[colIdx] !== undefined ? row[colIdx] : '';
      });
      parsedObjects.push(obj);
    }

    return parsedObjects;
  }

  // --- Spreadsheet & CSV Parsing ---
  function handleFileUpload(file, target) {
    state.currentMappingTarget = target;
    const reader = new FileReader();
    
    if (file.name.endsWith('.csv')) {
      reader.onload = function (e) {
        const text = e.target.result;
        parseCSVText(text);
      };
      reader.readAsText(file);
    } else {
      reader.onload = function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Parse as raw 2D array of rows
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const cleanedData = preprocessRawRows(rawRows);
        openMappingModal(cleanedData, file.name);
      };
      reader.readAsArrayBuffer(file);
    }
  }

  function parseCSVText(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return;

    // Detect separator
    const firstLine = lines[0];
    let separator = ',';
    if (firstLine.includes('\t')) separator = '\t';
    else if (firstLine.includes(';')) separator = ';';

    const rawRows = lines.map(line => {
      return line.split(separator).map(v => v.replace(/^["']|["']$/g, '').trim());
    });

    const cleanedData = preprocessRawRows(rawRows);
    openMappingModal(cleanedData, state.currentMappingTarget === 'prev' ? els.filePrev.files[0].name : els.fileLat.files[0].name);
  }

  // --- Column Mapping Modal ---
  function openMappingModal(jsonData, fileName) {
    const target = state.currentMappingTarget;
    if (target === 'prev') {
      state.prevRawData = jsonData;
      state.prevFileName = fileName;
    } else {
      state.latRawData = jsonData;
      state.latFileName = fileName;
    }

    els.mappingModalTitle.textContent = `Configure Mapping: ${fileName} (${target === 'prev' ? 'Previous Run' : 'Latest Run'})`;
    
    // Get headers
    const sample = jsonData[0] || {};
    const headers = Object.keys(sample);

    // Populate dropdown selects
    const selects = [
      els.mapDistance, els.mapType, els.mapClock, 
      els.mapDepth, els.mapLength, els.mapWidth, els.mapJointId,
      els.mapWT, els.mapJointLength, els.mapUsWeldDist
    ];

    selects.forEach(select => {
      select.innerHTML = '';
      
      // Add "None" or placeholder option for optional columns
      if (select !== els.mapDistance && select !== els.mapClock && select !== els.mapDepth) {
        const opt = document.createElement('option');
        opt.value = '__none__';
        opt.textContent = 'None / Ignore';
        select.appendChild(opt);
      }

      headers.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        select.appendChild(opt);
      });
    });

    // Auto-map headers heuristically
    autoMapHeaders(headers);

    // Build Preview Table (first 5 rows)
    const previewHead = els.previewTable.querySelector('thead');
    const previewBody = els.previewTable.querySelector('tbody');
    previewHead.innerHTML = '';
    previewBody.innerHTML = '';

    // Headers row
    const hr = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('hth'); // Using standard element structure
      const thNode = document.createElement('th');
      thNode.textContent = h;
      hr.appendChild(thNode);
    });
    previewHead.appendChild(hr);

    // Data rows
    const limit = Math.min(jsonData.length, 5);
    for (let i = 0; i < limit; i++) {
      const tr = document.createElement('tr');
      headers.forEach(h => {
        const td = document.createElement('td');
        td.textContent = jsonData[i][h] !== undefined ? jsonData[i][h] : '';
        tr.appendChild(td);
      });
      previewBody.appendChild(tr);
    }

    els.mappingModal.classList.add('active');
  }

  function autoMapHeaders(headers) {
    function findMatch(regex, list, fallbackSelect) {
      const match = list.find(h => regex.test(h.toLowerCase()));
      if (match) fallbackSelect.value = match;
    }

    findMatch(/distance|dist|odo|log|meter|position/i, headers, els.mapDistance);
    findMatch(/type|feature|class|desc/i, headers, els.mapType);
    findMatch(/clock|orient|time|hour|deg/i, headers, els.mapClock);
    findMatch(/depth|loss|pct|percent|%/i, headers, els.mapDepth);
    findMatch(/length|len|l_mm/i, headers, els.mapLength);
    findMatch(/width|wid|w_mm/i, headers, els.mapWidth);
    findMatch(/joint|jt|weld_no|weld_id/i, headers, els.mapJointId);
    findMatch(/wt|wall|thickness|nom.*t|measured.*t/i, headers, els.mapWT);
    findMatch(/joint.*length|component.*length|length.*joint/i, headers, els.mapJointLength);
    findMatch(/u.*s.*distance|upstream|u.*s.*weld|distance.*weld|dist.*weld|weld.*dist/i, headers, els.mapUsWeldDist);
  }

  function applyColumnMapping() {
    const target = state.currentMappingTarget;
    const raw = target === 'prev' ? state.prevRawData : state.latRawData;

    const mappedDistance = els.mapDistance.value;
    const mappedType = els.mapType.value;
    const mappedClock = els.mapClock.value;
    const mappedDepth = els.mapDepth.value;
    const mappedLength = els.mapLength.value;
    const mappedWidth = els.mapWidth.value;
    const mappedJointId = els.mapJointId.value;
    const mappedWT = els.mapWT.value;
    const mappedJointLength = els.mapJointLength.value;
    const mappedUsWeldDist = els.mapUsWeldDist.value;

    const parsedWelds = [];
    const parsedDefects = [];
    const parsedLandmarks = [];

    raw.forEach((row, index) => {
      const dist = parseFloat(row[mappedDistance]);
      if (isNaN(dist)) return; // Skip invalid distances

      const typeStr = mappedType !== '__none__' ? (row[mappedType] || '').toString().toLowerCase().trim() : '';
      const depthVal = parseFloat(row[mappedDepth]);
      const wtVal = mappedWT !== '__none__' ? parseFloat(row[mappedWT]) : null;
      const jlVal = mappedJointLength !== '__none__' ? parseFloat(row[mappedJointLength]) : null;
      const usWeldDistVal = mappedUsWeldDist !== '__none__' ? parseFloat(row[mappedUsWeldDist]) : null;

      // Categorize entry
      const isWeld = typeStr === 'weld' || typeStr === 'gw' || typeStr === 'girth weld';
      const isDefect = !isWeld && (
        (!isNaN(depthVal) && depthVal > 0) || 
        typeStr.includes('loss') || 
        typeStr.includes('corrosion') || 
        typeStr.includes('defect') || 
        typeStr.includes('anomaly') ||
        typeStr.includes('pinhole') ||
        typeStr.includes('slotting')
      );

      if (isWeld) {
        parsedWelds.push({
          id: mappedJointId !== '__none__' ? row[mappedJointId] : `GW-${index}`,
          distance: dist,
          type: 'Weld',
          jointLength: isNaN(jlVal) || jlVal === null ? state.nominalJointLength : jlVal
        });
      } else if (isDefect) {
        const lenVal = mappedLength !== '__none__' ? parseFloat(row[mappedLength]) : 15;
        const widVal = mappedWidth !== '__none__' ? parseFloat(row[mappedWidth]) : 15;
        const clockVal = row[mappedClock];

        parsedDefects.push({
          id: `DF-${target.toUpperCase()}-${index}`,
          distance: dist,
          type: 'Defect',
          depth: isNaN(depthVal) ? 0 : depthVal,
          length: isNaN(lenVal) ? 15 : lenVal,
          width: isNaN(widVal) ? 15 : widVal,
          clock: clockVal,
          clockRatio: parseClockToRatio(clockVal),
          jointId: mappedJointId !== '__none__' ? row[mappedJointId] : '',
          wt: isNaN(wtVal) || wtVal === null ? state.thickness : wtVal,
          usWeldDist: isNaN(usWeldDistVal) || usWeldDistVal === null ? null : usWeldDistVal,
          description: `Corrosion anomaly`
        });
      } else if (typeStr !== '') {
        // Reference Landmark (e.g. Bend, Valve, Tee, flange)
        parsedLandmarks.push({
          id: `LM-${target.toUpperCase()}-${index}`,
          distance: dist,
          type: row[mappedType] || 'Landmark',
          label: row[mappedJointId] ? `Jt ${row[mappedJointId]}` : '',
          wt: isNaN(wtVal) || wtVal === null ? state.thickness : wtVal
        });
      }
    });

    // Sort by distance
    parsedWelds.sort((a, b) => a.distance - b.distance);
    parsedDefects.sort((a, b) => a.distance - b.distance);
    parsedLandmarks.sort((a, b) => a.distance - b.distance);

    if (target === 'prev') {
      state.prevWelds = parsedWelds;
      state.prevDefects = parsedDefects;
      state.prevLandmarks = parsedLandmarks;
      state.prevMapping = { mappedDistance, mappedType, mappedClock, mappedDepth, mappedLength, mappedWidth, mappedJointId, mappedWT, mappedJointLength, mappedUsWeldDist };
      els.namePrev.textContent = state.prevFileName;
      els.statusPrev.textContent = `Loaded: ${parsedWelds.length} welds, ${parsedDefects.length} defects, ${parsedLandmarks.length} landmarks`;
      els.statusPrev.className = 'status-indicator loaded';
    } else {
      state.latWelds = parsedWelds;
      state.latDefects = parsedDefects;
      state.latLandmarks = parsedLandmarks;
      state.latMapping = { mappedDistance, mappedType, mappedClock, mappedDepth, mappedLength, mappedWidth, mappedJointId, mappedWT, mappedJointLength, mappedUsWeldDist };
      els.nameLat.textContent = state.latFileName;
      els.statusLat.textContent = `Loaded: ${parsedWelds.length} welds, ${parsedDefects.length} defects, ${parsedLandmarks.length} landmarks`;
      els.statusLat.className = 'status-indicator loaded';
    }

    // Automatically update UI inputs based on the uploaded data to avoid discrepancies
    if (parsedWelds.length > 0 && mappedJointLength !== '__none__') {
      const lengths = parsedWelds.map(w => w.jointLength).filter(l => !isNaN(l) && l > 0).sort((a, b) => a - b);
      if (lengths.length > 0) {
        const medianJointLen = lengths[Math.floor(lengths.length / 2)];
        els.inputJointLength.value = medianJointLen.toFixed(1);
        state.nominalJointLength = medianJointLen;
      }
    }

    const wtValues = [...parsedDefects, ...parsedLandmarks]
      .map(item => item.wt)
      .filter(wt => wt !== null && !isNaN(wt) && wt > 0);
      
    if (wtValues.length > 0 && mappedWT !== '__none__') {
      const counts = {};
      let maxCount = 0;
      let modeWT = wtValues[0];
      
      wtValues.forEach(wt => {
        counts[wt] = (counts[wt] || 0) + 1;
        if (counts[wt] > maxCount) {
          maxCount = counts[wt];
          modeWT = wt;
        }
      });
      
      els.inputWT.value = modeWT.toFixed(2);
      state.thickness = modeWT;
    }

    // Auto generate welds if box is checked and no welds were found
    if (els.chkAutoWeldGen.checked) {
      ensureGirthWelds(target);
    }

    els.mappingModal.classList.remove('active');

    // Run Alignment if both files are ready
    if (state.prevDefects.length > 0 && state.latDefects.length > 0) {
      processDataAndAlign();
    }
  }

  // --- Rendering Pipeline Canvas ---
  function resizeCanvases() {
    const parentPrev = els.canvasPrev.parentElement;
    els.canvasPrev.width = parentPrev.clientWidth;
    els.canvasPrev.height = parentPrev.clientHeight;

    const parentLat = els.canvasLat.parentElement;
    els.canvasLat.width = parentLat.clientWidth;
    els.canvasLat.height = parentLat.clientHeight;

    const parentMinimap = els.canvasMinimap.parentElement;
    els.canvasMinimap.width = parentMinimap.clientWidth;
    els.canvasMinimap.height = parentMinimap.clientHeight;

    renderAll();
  }

  function renderAll() {
    if (!ctxPrev || !ctxLat || !ctxMinimap) return;

    if (els.zoomLevelDisplay) {
      const zoomPercent = Math.round((state.zoom / 15) * 100);
      els.zoomLevelDisplay.textContent = `${zoomPercent}%`;
    }

    renderUnrolledChart(ctxPrev, els.canvasPrev, 'prev');
    renderUnrolledChart(ctxLat, els.canvasLat, 'lat');
    renderMinimap(ctxMinimap, els.canvasMinimap);
  }

  function getDefectColor(defect, isPrev = false) {
    if (state.colorMode === 'status') {
      // Find matching pair
      if (isPrev) {
        const isMatched = state.matchedDefects.some(m => m.prev.id === defect.id);
        return isMatched ? '#3b82f6' : '#10b981'; // Blue = matched, Green = repaired
      } else {
        const isMatched = state.matchedDefects.some(m => m.lat.id === defect.id);
        return isMatched ? '#3b82f6' : '#8b5cf6'; // Blue = matched, Purple = new defect
      }
    } else if (state.colorMode === 'growth') {
      // Show growth mapping
      if (isPrev) {
        return 'rgba(148, 163, 184, 0.4)'; // Gray for previous in growth mode
      } else {
        const pair = state.matchedDefects.find(m => m.lat.id === defect.id);
        if (!pair) return '#8b5cf6'; // Purple for new defect (no growth history)
        
        // Depth Growth values
        const growth = pair.growth;
        if (growth <= 0) return '#10b981'; // Green (stable)
        if (growth <= 5) return '#f59e0b';  // Orange (moderate growth)
        return '#ef4444';                   // Red (active growth)
      }
    } else {
      // Color by Depth
      const depth = defect.depth;
      if (depth < 10) return '#10b981';       // Green
      if (depth < 25) return '#f59e0b';       // Yellow/Orange
      if (depth < 40) return '#f97316';       // Dark Orange
      return '#ef4444';                       // Critical Red
    }
  }

  function renderUnrolledChart(ctx, canvas, runType) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const welds = runType === 'prev' ? (state.alignedPrevWelds.length > 0 ? state.alignedPrevWelds : state.prevWelds) : state.latWelds;
    const defects = runType === 'prev' ? state.alignedPrevDefects : state.latDefects;
    const isPrev = runType === 'prev';
    const isLight = isLightTheme(); // Cached once to avoid layout thrashing inside tight loops

    // Map screen bounds to distances
    const startM = state.panOffset;
    const endM = startM + (W / state.zoom);

    // --- 1. Draw Grid Lines ---
    ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(43, 62, 102, 0.25)';
    ctx.lineWidth = 1;
    ctx.fillStyle = isLight ? 'rgba(71, 85, 105, 0.8)' : 'rgba(148, 163, 184, 0.6)';
    ctx.font = '10px Outfit';

    // Horizontal clock positions grid (every 3 hours: 12:00, 3:00, 6:00, 9:00, 12:00)
    const clocks = [0, 0.25, 0.5, 0.75, 1];
    clocks.forEach(ratio => {
      const y = ratio * (H - 30) + 15;
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Clock Label
      ctx.fillText(ratioToClockStr(ratio), 6, y - 4);
    });

    // Vertical Distance grid (every 10m or 50m depending on zoom)
    const gridSpacing = state.zoom > 10 ? 10 : 50;
    const firstGrid = Math.ceil(startM / gridSpacing) * gridSpacing;
    for (let d = firstGrid; d <= endM; d += gridSpacing) {
      const x = (d - startM) * state.zoom;
      ctx.beginPath();
      ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(43, 62, 102, 0.15)';
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.fillText(`${d}m`, x + 4, H - 6);
    }

    // --- 2. Draw Girth Welds ---
    if (state.showWelds) {
      const startIdx = binarySearchFirstIndex(welds, w => (isPrev && w.alignedDistance !== undefined) ? w.alignedDistance : w.distance, startM - 20);
      for (let i = startIdx; i < welds.length; i++) {
        const weld = welds[i];
        const currentDist = (isPrev && weld.alignedDistance !== undefined) ? weld.alignedDistance : weld.distance;
        if (currentDist > endM + 20) break;

        const x = (currentDist - startM) * state.zoom;
        ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.8)' : 'rgba(71, 85, 105, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 15);
        ctx.lineTo(x, H - 15);
        ctx.stroke();

        // Draw weld label
        ctx.save();
        ctx.translate(x - 4, H - 30);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = isLight ? 'rgba(30, 41, 59, 0.9)' : 'rgba(148, 163, 184, 0.8)';
        let label = weld.id;
        if (weld.jointLength) {
          label += ` (L: ${weld.jointLength.toFixed(1)}m)`;
        }
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }

    // --- 2b. Draw Reference Landmarks (e.g. Bends, Valves, Tees) ---
    const landmarks = runType === 'prev' ? state.alignedPrevLandmarks : state.latLandmarks;
    const startLmIdx = binarySearchFirstIndex(landmarks, lm => isPrev ? lm.alignedDistance : lm.distance, startM - 20);
    for (let i = startLmIdx; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const currentDist = isPrev ? lm.alignedDistance : lm.distance;
      if (currentDist > endM + 20) break;

      const x = (currentDist - startM) * state.zoom;
      
      // Draw dotted vertical line for landmark
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)'; // Gold / Orange tint
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.setLineDash([5, 3]);
      ctx.moveTo(x, 15);
      ctx.lineTo(x, H - 15);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label vertically near the bottom of the line
      ctx.save();
      ctx.translate(x + 4, H - 25);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
      ctx.font = 'bold 9px Outfit';
      ctx.fillText(`${lm.type} ${lm.label ? '(' + lm.label + ')' : ''}`, 0, 0);
      ctx.restore();
    }

    // --- 3. Draw Defects ---
    const startDefIdx = binarySearchFirstIndex(defects, def => isPrev ? def.alignedDistance : def.distance, startM - 20);
    for (let i = startDefIdx; i < defects.length; i++) {
      const def = defects[i];
      const currentDist = isPrev ? def.alignedDistance : def.distance;
      if (currentDist > endM + 20) break;

      const x = (currentDist - startM) * state.zoom;
      const y = def.clockRatio * (H - 30) + 15;

      const baseColor = getDefectColor(def, isPrev);
      const isHovered = (state.selectedDefectId === def.id);

      // Width & Length in physical pixels
      const circ = Math.PI * state.diameter; // mm
      const pxWidth = Math.max((def.width / circ) * (H - 30), 8);
      const pxLength = Math.max((def.length / 1000) * state.zoom, 8);

      // Draw Defect marker
      ctx.save();
      
      // Draw hover glow
      if (isHovered) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = baseColor;
      }

      ctx.fillStyle = baseColor;
      ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = isHovered ? 2 : 1;

      // Draw rectangular box representation of corrosion defect
      ctx.beginPath();
      ctx.rect(x - pxLength / 2, y - pxWidth / 2, pxLength, pxWidth);
      ctx.fill();
      ctx.stroke();

      // Show depth label if zoomed in sufficiently
      if (state.zoom > 12) {
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 9px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(def.depth)}`, x, y);
      }

      ctx.restore();
    }

    // --- 4. Draw Match Link connection lines (only on Latest Run canvas) ---
    if (!isPrev && state.showLinks && state.matchedDefects.length > 0) {
      const startMatchIdx = binarySearchFirstIndex(state.matchedDefects, pair => pair.lat.distance, startM - 20);
      for (let i = startMatchIdx; i < state.matchedDefects.length; i++) {
        const pair = state.matchedDefects[i];
        if (pair.lat.distance > endM + 20) break;

        const prevDistAligned = pair.prev.alignedDistance;
        const latDist = pair.lat.distance;

        // Skip if outside viewport
        if (latDist < startM - 20 && prevDistAligned < startM - 20) continue;
        if (latDist > endM + 20 && prevDistAligned > endM + 20) continue;

        const xPrev = (prevDistAligned - startM) * state.zoom;
        const yPrev = pair.prev.clockRatio * (H - 30) + 15;

        const xLat = (latDist - startM) * state.zoom;
        const yLat = pair.lat.clockRatio * (H - 30) + 15;

        // Draw dotted connection line between aligned positions
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1.5;
        ctx.moveTo(xPrev, yPrev);
        ctx.lineTo(xLat, yLat);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // --- 5. Draw Sync Dotted Hover Cursor ---
    if (state.hoverDist !== null) {
      const hx = (state.hoverDist - startM) * state.zoom;
      
      // Vertical cursor line
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, H);
      ctx.stroke();

      // Horizontal cursor line (only if we are hovering a clock ratio)
      if (state.hoverClockRatio !== null) {
        const hy = state.hoverClockRatio * (H - 30) + 15;
        ctx.beginPath();
        ctx.moveTo(0, hy);
        ctx.lineTo(W, hy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  function renderMinimap(ctx, canvas) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const isLight = isLightTheme(); // Cached once to avoid layout thrashing inside tight loops

    // Draw background pipeline bar
    ctx.fillStyle = isLight ? '#e2e8f0' : '#090d16';
    ctx.fillRect(0, 10, W, H - 20);
    ctx.strokeStyle = isLight ? '#cbd5e1' : 'rgba(43, 62, 102, 0.4)';
    ctx.strokeRect(0, 10, W, H - 20);

    // Draw defects density
    const allDefects = [...state.alignedPrevDefects, ...state.latDefects];
    if (allDefects.length > 0) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
      allDefects.forEach(def => {
        const x = (def.distance / state.maxDistance) * W;
        ctx.fillRect(x - 1, 10, 2, H - 20);
      });
    }

    // Draw viewport indicator (panning window slider)
    const viewWidthM = W / state.zoom;
    const viewLeftRatio = state.panOffset / state.maxDistance;
    const viewWidthRatio = (els.canvasPrev.width / state.zoom) / state.maxDistance;

    const boxX = viewLeftRatio * W;
    const boxW = Math.max(viewWidthRatio * W, 10);

    ctx.fillStyle = isLight ? 'rgba(37, 99, 235, 0.08)' : 'rgba(59, 130, 246, 0.15)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.fillRect(boxX, 10, boxW, H - 20);
    ctx.strokeRect(boxX, 10, boxW, H - 20);
  }

  // --- Grid / Table population & Filtering ---
  function fillComparisonTable() {
    els.defectTableBody.innerHTML = '';

    const filterVal = els.filterStatus.value;
    const searchVal = els.tableSearch.value.toLowerCase();

    // Consolidate rows
    const rows = [];

    // 1. Matched Pairs
    state.matchedDefects.forEach(pair => {
      rows.push({
        status: 'matched',
        jointId: pair.lat.jointId || pair.prev.jointId || 'Joint',
        distPrev: pair.prev.distance,
        distLat: pair.lat.distance,
        usWeldDistPrev: pair.prev.usWeldDist,
        usWeldDistLat: pair.lat.usWeldDist,
        clock: pair.lat.clock,
        sizePrev: `${pair.prev.depth}% (${pair.prev.length}x${pair.prev.width})`,
        sizeLat: `${pair.lat.depth}% (${pair.lat.length}x${pair.lat.width})`,
        growth: pair.growth,
        depthLat: pair.lat.depth,
        rawPair: pair
      });
    });

    // 2. New Defects
    state.unmatchedLat.forEach(def => {
      rows.push({
        status: 'new',
        jointId: def.jointId || 'Joint',
        distPrev: null,
        distLat: def.distance,
        usWeldDistPrev: null,
        usWeldDistLat: def.usWeldDist,
        clock: def.clock,
        sizePrev: '-',
        sizeLat: `${def.depth}% (${def.length}x${def.width})`,
        growth: null,
        depthLat: def.depth,
        rawDefect: def
      });
    });

    // 3. Repaired Defects
    state.unmatchedPrev.forEach(def => {
      rows.push({
        status: 'repaired',
        jointId: def.jointId || 'Joint',
        distPrev: def.distance,
        distLat: null,
        usWeldDistPrev: def.usWeldDist,
        usWeldDistLat: null,
        clock: def.clock,
        sizePrev: `${def.depth}% (${def.length}x${def.width})`,
        sizeLat: '-',
        growth: null,
        depthLat: null,
        rawDefect: def
      });
    });

    // Sort rows by Latest distance, fallback to Previous distance
    rows.sort((a, b) => {
      const d1 = a.distLat !== null ? a.distLat : a.distPrev;
      const d2 = b.distLat !== null ? b.distLat : b.distPrev;
      return d1 - d2;
    });

    // Filter rows
    const filteredRows = rows.filter(r => {
      // Search filter
      const matchesSearch = 
        r.jointId.toLowerCase().includes(searchVal) || 
        (r.rawPair && (r.rawPair.prev.id.toLowerCase().includes(searchVal) || r.rawPair.lat.id.toLowerCase().includes(searchVal))) ||
        (r.rawDefect && r.rawDefect.id.toLowerCase().includes(searchVal)) ||
        (r.distPrev !== null && r.distPrev.toFixed(2).includes(searchVal)) ||
        (r.distLat !== null && r.distLat.toFixed(2).includes(searchVal));

      if (!matchesSearch) return false;

      // Status filter
      if (filterVal === 'matched' && r.status !== 'matched') return false;
      if (filterVal === 'new' && r.status !== 'new') return false;
      if (filterVal === 'repaired' && r.status !== 'repaired') return false;
      if (filterVal === 'critical') {
        const isCrit = (r.depthLat !== null && r.depthLat >= 40) || (r.rawPair && r.rawPair.prev.depth >= 40);
        if (!isCrit) return false;
      }
      return true;
    });

    // Auto page-jumping when a row is selected/focused from canvas
    if (state.selectedDefectId && state.shouldJumpToPage) {
      const idx = filteredRows.findIndex(r => {
        const id = r.rawPair ? r.rawPair.lat.id : r.rawDefect.id;
        return id === state.selectedDefectId;
      });
      if (idx !== -1) {
        state.defectCurrentPage = Math.floor(idx / state.pageSize) + 1;
      }
      state.shouldJumpToPage = false; // Reset flag so manual paging is not overridden
    }

    const totalItems = filteredRows.length;
    const totalPages = Math.ceil(totalItems / state.pageSize) || 1;
    if (state.defectCurrentPage > totalPages) {
      state.defectCurrentPage = totalPages;
    }
    if (state.defectCurrentPage < 1) {
      state.defectCurrentPage = 1;
    }

    // Slice for pagination
    const startIndex = (state.defectCurrentPage - 1) * state.pageSize;
    const endIndex = Math.min(startIndex + state.pageSize, totalItems);
    const pageRows = filteredRows.slice(startIndex, endIndex);

    // Render paginated items
    pageRows.forEach(r => {
      const tr = document.createElement('tr');
      
      // Highlight matching row selection
      const defId = r.rawPair ? r.rawPair.lat.id : r.rawDefect.id;
      if (state.selectedDefectId === defId) {
        tr.style.background = 'var(--bg-card-hover)';
      }

      // 1. Status badge
      let badgeHtml = '';
      if (r.status === 'matched') badgeHtml = '<span class="badge badge-matched">Matched</span>';
      else if (r.status === 'new') badgeHtml = '<span class="badge badge-new">New Defect</span>';
      else if (r.status === 'repaired') badgeHtml = '<span class="badge badge-repaired">Repaired</span>';

      // 2. Growth column formatting
      let growthText = '-';
      let growthClass = '';
      if (r.growth !== null) {
        if (r.growth > 0) {
          growthText = `+${r.growth.toFixed(1)}%`;
          growthClass = r.growth >= 10 ? 'text-danger' : 'text-warning';
        } else if (r.growth < 0) {
          growthText = `${r.growth.toFixed(1)}%`;
          growthClass = 'text-success';
        } else {
          growthText = '0.0%';
        }
      }

      tr.innerHTML = `
        <td>${badgeHtml}</td>
        <td><strong>${r.jointId}</strong></td>
        <td>
          ${r.distPrev !== null ? r.distPrev.toFixed(2) + ' m' : '-'}
          ${r.usWeldDistPrev !== null && r.usWeldDistPrev !== undefined ? `<br><small style="color: var(--text-muted); font-size: 0.75rem;">U/S GW: ${r.usWeldDistPrev.toFixed(2)} m</small>` : ''}
        </td>
        <td>
          ${r.distLat !== null ? r.distLat.toFixed(2) + ' m' : '-'}
          ${r.usWeldDistLat !== null && r.usWeldDistLat !== undefined ? `<br><small style="color: var(--text-muted); font-size: 0.75rem;">U/S GW: ${r.usWeldDistLat.toFixed(2)} m</small>` : ''}
        </td>
        <td>${r.clock}</td>
        <td>${r.sizePrev}</td>
        <td>${r.sizeLat}</td>
        <td class="${growthClass}">${growthText}</td>
        <td><button class="btn btn-secondary btn-table-focus" data-dist="${r.distLat !== null ? r.distLat : r.distPrev}" data-id="${defId}">Focus</button></td>
      `;

      // Click to focus row
      tr.addEventListener('click', () => {
        setSelectedDefect(defId);
      });

      els.defectTableBody.appendChild(tr);
    });

    if (totalItems === 0) {
      els.defectTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-table-msg">No defects matching current filters.</td>
        </tr>
      `;
    }

    // Update pagination controls
    const btnPrev = document.getElementById('btnDefectPrev');
    const btnNext = document.getElementById('btnDefectNext');
    const pageInfo = document.getElementById('defectPageInfo');
    if (btnPrev && btnNext && pageInfo) {
      btnPrev.disabled = state.defectCurrentPage <= 1;
      btnNext.disabled = state.defectCurrentPage >= totalPages;
      pageInfo.textContent = `Page ${state.defectCurrentPage} of ${totalPages} (Total: ${totalItems})`;
    }
  }

  function fillWeldAlignmentTable() {
    els.weldTableBody.innerHTML = '';

    if (state.weldMatches.length === 0) {
      els.weldTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-table-msg">Upload Previous & Latest ILI data files or load Demo Data to align welds.</td>
        </tr>
      `;
      return;
    }

    const filterVal = els.filterWeldStatus.value;
    const searchVal = els.weldSearch.value.toLowerCase();

    // Reconstruct list of welds alignment based on state.weldMatches
    const rows = [];

    state.weldMatches.forEach(match => {
      let status = '';
      let prevId = '-';
      let prevDist = null;
      let prevLen = null;
      let latId = '-';
      let latDist = null;
      let latLen = null;
      let diff = null;

      if (match.type === 'match') {
        status = 'matched';
        const pWeld = state.prevWelds[match.idxPrev];
        const lWeld = state.latWelds[match.idxLat];
        
        prevId = pWeld.id;
        prevDist = pWeld.distance;
        prevLen = pWeld.jointLength;
        
        latId = lWeld.id;
        latDist = lWeld.distance;
        latLen = lWeld.jointLength;
        
        diff = prevLen !== null && latLen !== null ? latLen - prevLen : null;
      } else if (match.type === 'skip_prev') {
        status = 'skipped_prev';
        const pWeld = state.prevWelds[match.idxPrev];
        prevId = pWeld.id;
        prevDist = pWeld.distance;
        prevLen = pWeld.jointLength;
      } else if (match.type === 'skip_lat') {
        status = 'skipped_lat';
        const lWeld = state.latWelds[match.idxLat];
        latId = lWeld.id;
        latDist = lWeld.distance;
        latLen = lWeld.jointLength;
      }

      rows.push({
        status,
        prevId,
        prevDist,
        prevLen,
        latId,
        latDist,
        latLen,
        diff,
        match
      });
    });

    // Sort rows by Latest distance, fallback to Previous distance
    rows.sort((a, b) => {
      const d1 = a.latDist !== null ? a.latDist : a.prevDist;
      const d2 = b.latDist !== null ? b.latDist : b.prevDist;
      return d1 - d2;
    });

    // Filter rows
    const filteredRows = rows.filter(r => {
      // Search filter
      const matchesSearch = 
        r.prevId.toLowerCase().includes(searchVal) || 
        r.latId.toLowerCase().includes(searchVal) ||
        (r.prevDist !== null && r.prevDist.toFixed(2).includes(searchVal)) ||
        (r.latDist !== null && r.latDist.toFixed(2).includes(searchVal));

      if (!matchesSearch) return false;

      // Status filter
      if (filterVal === 'matched' && r.status !== 'matched') return false;
      if (filterVal === 'skipped_prev' && r.status !== 'skipped_prev') return false;
      if (filterVal === 'skipped_lat' && r.status !== 'skipped_lat') return false;

      return true;
    });

    const totalItems = filteredRows.length;
    const totalPages = Math.ceil(totalItems / state.pageSize) || 1;
    if (state.weldCurrentPage > totalPages) {
      state.weldCurrentPage = totalPages;
    }
    if (state.weldCurrentPage < 1) {
      state.weldCurrentPage = 1;
    }

    // Slice for pagination
    const startIndex = (state.weldCurrentPage - 1) * state.pageSize;
    const endIndex = Math.min(startIndex + state.pageSize, totalItems);
    const pageRows = filteredRows.slice(startIndex, endIndex);

    pageRows.forEach(r => {
      const tr = document.createElement('tr');

      // Status badge
      let badgeHtml = '';
      if (r.status === 'matched') {
        badgeHtml = '<span class="badge badge-matched">Matched</span>';
      } else if (r.status === 'skipped_prev') {
        badgeHtml = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">Prev Only (Missed in Lat)</span>';
      } else if (r.status === 'skipped_lat') {
        badgeHtml = '<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3);">Latest Only (Missed in Prev)</span>';
      }

      // Diff formatting
      let diffText = '-';
      let diffClass = '';
      if (r.diff !== null) {
        if (r.diff > 0.005) {
          diffText = `+${r.diff.toFixed(2)} m`;
          diffClass = 'text-warning';
        } else if (r.diff < -0.005) {
          diffText = `${r.diff.toFixed(2)} m`;
          diffClass = 'text-success';
        } else {
          diffText = '0.00 m';
        }
      }

      const focusDist = r.latDist !== null ? r.latDist : r.prevDist;

      tr.innerHTML = `
        <td>${badgeHtml}</td>
        <td><strong>${r.prevId}</strong></td>
        <td>${r.prevDist !== null ? r.prevDist.toFixed(2) + ' m' : '-'}</td>
        <td><strong>${r.latId}</strong></td>
        <td>${r.latDist !== null ? r.latDist.toFixed(2) + ' m' : '-'}</td>
        <td>${r.prevLen !== null ? r.prevLen.toFixed(2) + ' m' : '-'}</td>
        <td>${r.latLen !== null ? r.latLen.toFixed(2) + ' m' : '-'}</td>
        <td class="${diffClass}">${diffText}</td>
        <td><button class="btn btn-secondary btn-weld-focus" data-dist="${focusDist}">Focus</button></td>
      `;

      els.weldTableBody.appendChild(tr);
    });

    if (totalItems === 0) {
      els.weldTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-table-msg">No welds matching current filters.</td>
        </tr>
      `;
    }

    // Update pagination controls
    const btnPrev = document.getElementById('btnWeldPrev');
    const btnNext = document.getElementById('btnWeldNext');
    const pageInfo = document.getElementById('weldPageInfo');
    if (btnPrev && btnNext && pageInfo) {
      btnPrev.disabled = state.weldCurrentPage <= 1;
      btnNext.disabled = state.weldCurrentPage >= totalPages;
      pageInfo.textContent = `Page ${state.weldCurrentPage} of ${totalPages} (Total: ${totalItems})`;
    }
  }

  function setSelectedDefect(defectId) {
    state.selectedDefectId = defectId;
    state.shouldJumpToPage = true; // Set flag to trigger table page-jump to this defect
    
    // Find defect distance to pan to
    let dist = null;
    const allDefs = [...state.alignedPrevDefects, ...state.latDefects];
    const target = allDefs.find(d => d.id === defectId);
    if (target) {
      dist = target.alignedDistance || target.distance;
    }

    if (dist !== null) {
      // Center view on this distance
      const viewWidth = els.canvasPrev.width / state.zoom;
      state.panOffset = Math.max(0, dist - viewWidth / 2);
    }

    renderAll();
    fillComparisonTable();
  }

  // --- Sync Interaction Coordinates ---
  function getDistanceForX(xPixel, canvasWidth) {
    const viewWidth = canvasWidth / state.zoom;
    return state.panOffset + (xPixel / canvasWidth) * viewWidth;
  }

  function getClockRatioForY(yPixel, canvasHeight) {
    const paddedHeight = canvasHeight - 30;
    const paddedY = yPixel - 15;
    const ratio = paddedY / paddedHeight;
    return Math.max(0, Math.min(1, ratio));
  }

  function handleCanvasMouseMove(e, runType) {
    const canvas = runType === 'prev' ? els.canvasPrev : els.canvasLat;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clickedDist = getDistanceForX(x, canvas.width);
    const clickedClockRatio = getClockRatioForY(y, canvas.height);

    // Sync hover parameters
    state.hoverDist = clickedDist;
    state.hoverClockRatio = clickedClockRatio;

    // Check for defect hit
    const defects = runType === 'prev' ? state.alignedPrevDefects : state.latDefects;
    let hitDefect = null;
    const thresholdM = Math.max(0.15, 15 / state.zoom); // 15 pixels hover tolerance, min 0.15m
    const thresholdClock = 0.05; // 5% clock ratio threshold

    defects.forEach(def => {
      const defDist = runType === 'prev' ? def.alignedDistance : def.distance;
      const dX = Math.abs(clickedDist - defDist);
      const dY = getClockRatioDiff(clickedClockRatio, def.clockRatio);

      if (dX <= thresholdM && dY <= thresholdClock) {
        hitDefect = def;
      }
    });

    // Populate and show tooltip if hit
    if (hitDefect) {
      state.selectedDefectId = hitDefect.id;
      showFloatTooltip(hitDefect, e.clientX, e.clientY, runType);
    } else {
      els.floatTooltip.style.display = 'none';
    }

    renderAll();
  }

  function showFloatTooltip(defect, clientX, clientY, runType) {
    const isPrev = runType === 'prev';
    const otherType = isPrev ? 'lat' : 'prev';
    
    // Check for matched defect
    let matchedPair = null;
    if (isPrev) {
      matchedPair = state.matchedDefects.find(m => m.prev.id === defect.id);
    } else {
      matchedPair = state.matchedDefects.find(m => m.lat.id === defect.id);
    }

    let statusHtml = '';
    let compTableHtml = '';

    if (matchedPair) {
      statusHtml = '<span class="badge badge-matched">Matched</span>';
      const growth = matchedPair.growth;
      const gColor = growth > 0 ? '#ef4444' : growth < 0 ? '#10b981' : '#f1f5f9';
      
      const prevWT = matchedPair.prev.wt !== undefined ? matchedPair.prev.wt : state.thickness;
      const latWT = matchedPair.lat.wt !== undefined ? matchedPair.lat.wt : state.thickness;
      const prevDepthMm = prevWT * (matchedPair.prev.depth / 100);
      const latDepthMm = latWT * (matchedPair.lat.depth / 100);

      compTableHtml = `
        <table>
          <tr>
            <td></td>
            <td class="lbl">Prev Run</td>
            <td class="lbl">Latest Run</td>
          </tr>
          <tr>
            <td class="lbl">Distance:</td>
            <td>${matchedPair.prev.distance.toFixed(2)} m</td>
            <td>${matchedPair.lat.distance.toFixed(2)} m</td>
          </tr>
          <tr>
            <td class="lbl">U/S Weld Dist:</td>
            <td>${matchedPair.prev.usWeldDist.toFixed(2)} m</td>
            <td>${matchedPair.lat.usWeldDist.toFixed(2)} m</td>
          </tr>
          <tr>
            <td class="lbl">Clock:</td>
            <td>${matchedPair.prev.clock}</td>
            <td>${matchedPair.lat.clock}</td>
          </tr>
          <tr>
            <td class="lbl">Wall thickness:</td>
            <td>${prevWT.toFixed(1)} mm</td>
            <td>${latWT.toFixed(1)} mm</td>
          </tr>
          <tr>
            <td class="lbl">Depth:</td>
            <td>${matchedPair.prev.depth}% (${prevDepthMm.toFixed(1)} mm)</td>
            <td>${matchedPair.lat.depth}% (${latDepthMm.toFixed(1)} mm)</td>
          </tr>
          <tr>
            <td class="lbl">Size (L×W):</td>
            <td>${matchedPair.prev.length}x${matchedPair.prev.width} mm</td>
            <td>${matchedPair.lat.length}x${matchedPair.lat.width} mm</td>
          </tr>
          <tr style="border-top: 1px solid var(--border-color)">
            <td class="lbl">Depth Growth:</td>
            <td colspan="2" style="color: ${gColor}; font-weight: bold;">
              ${growth > 0 ? '+' : ''}${growth.toFixed(1)}%
            </td>
          </tr>
        </table>
      `;
    } else {
      const isNew = state.unmatchedLat.some(d => d.id === defect.id);
      statusHtml = isNew ? '<span class="badge badge-new">New Defect</span>' : '<span class="badge badge-repaired">Repaired</span>';
      
      const wtVal = defect.wt !== undefined ? defect.wt : state.thickness;
      const depthMm = wtVal * (defect.depth / 100);

      compTableHtml = `
        <table>
          <tr>
            <td class="lbl">Distance:</td>
            <td>${defect.distance.toFixed(2)} m</td>
          </tr>
          <tr>
            <td class="lbl">U/S Weld Dist:</td>
            <td>${defect.usWeldDist.toFixed(2)} m</td>
          </tr>
          <tr>
            <td class="lbl">Clock:</td>
            <td>${defect.clock}</td>
          </tr>
          <tr>
            <td class="lbl">Wall thickness:</td>
            <td>${wtVal.toFixed(1)} mm</td>
          </tr>
          <tr>
            <td class="lbl">Depth:</td>
            <td>${defect.depth}% (${depthMm.toFixed(1)} mm)</td>
          </tr>
          <tr>
            <td class="lbl">Size (L×W):</td>
            <td>${defect.length}x${defect.width} mm</td>
          </tr>
        </table>
      `;
    }

    els.floatTooltip.innerHTML = `
      <h4>
        <span>Defect ID: ${defect.id}</span>
        ${statusHtml}
      </h4>
      ${compTableHtml}
    `;

    // Position tooltip nicely relative to mouse
    els.floatTooltip.style.display = 'block';
    els.floatTooltip.style.left = `${clientX + 15}px`;
    els.floatTooltip.style.top = `${clientY + 15}px`;
  }

  function zoomAroundAnchor(zoomFactor, anchorM, screenX) {
    state.zoom = Math.max(2, Math.min(state.zoom * zoomFactor, 100));
    const newPan = anchorM - (screenX / state.zoom);
    state.panOffset = Math.max(0, Math.min(state.maxDistance - els.canvasPrev.width / state.zoom, newPan));
  }

  // --- Interaction Event Listeners ---
  function setupEventListeners() {
    // Parameter inputs
    els.inputOD.addEventListener('change', (e) => {
      state.diameter = parseFloat(e.target.value) || 762;
      updatePipelineCircumferenceLabel();
      renderAll();
      markOutOfSync();
    });
    els.inputWT.addEventListener('change', (e) => {
      state.thickness = parseFloat(e.target.value) || 12.7;
      renderAll();
      markOutOfSync();
    });
    els.inputJointLength.addEventListener('change', (e) => {
      state.nominalJointLength = parseFloat(e.target.value) || 12;
      markOutOfSync();
    });
    els.inputTolerance.addEventListener('change', (e) => {
      state.tolerance = parseFloat(e.target.value) || 10;
      markOutOfSync();
    });
    els.inputMatchDist.addEventListener('change', (e) => {
      state.matchDistance = parseFloat(e.target.value) || 1.0;
      markOutOfSync();
    });
    els.inputMatchClock.addEventListener('change', (e) => {
      state.matchClock = parseFloat(e.target.value) || 60;
      markOutOfSync();
    });
    els.inputDepthWeight.addEventListener('change', (e) => {
      state.depthWeight = parseFloat(e.target.value) || 0.01;
      markOutOfSync();
    });
    els.inputWeldDistWeight.addEventListener('change', (e) => {
      state.weldDistWeight = parseFloat(e.target.value) || 1.0;
      markOutOfSync();
    });

    els.btnRecalculate.addEventListener('click', () => {
      processDataAndAlign();
    });

    // File selection
    els.filePrev.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0], 'prev');
      }
    });
    els.fileLat.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0], 'lat');
      }
    });

    // Toolbar actions
    els.btnZoomIn.addEventListener('click', () => {
      const viewWidth = els.canvasPrev.width / state.zoom;
      const anchorM = state.hoverDist !== null ? state.hoverDist : (state.panOffset + viewWidth / 2);
      const screenX = state.hoverDist !== null ? (state.hoverDist - state.panOffset) * state.zoom : (els.canvasPrev.width / 2);
      zoomAroundAnchor(1.3, anchorM, screenX);
      renderAll();
    });
    els.btnZoomOut.addEventListener('click', () => {
      const viewWidth = els.canvasPrev.width / state.zoom;
      const anchorM = state.hoverDist !== null ? state.hoverDist : (state.panOffset + viewWidth / 2);
      const screenX = state.hoverDist !== null ? (state.hoverDist - state.panOffset) * state.zoom : (els.canvasPrev.width / 2);
      zoomAroundAnchor(1 / 1.3, anchorM, screenX);
      renderAll();
    });
    els.btnZoomFit.addEventListener('click', () => {
      const W = els.canvasPrev.width;
      state.zoom = W / state.maxDistance;
      state.panOffset = 0;
      renderAll();
    });
    
    els.chkShowWelds.addEventListener('change', (e) => {
      state.showWelds = e.target.checked;
      renderAll();
    });
    els.chkShowLinks.addEventListener('change', (e) => {
      state.showLinks = e.target.checked;
      renderAll();
    });
    els.selColorMode.addEventListener('change', (e) => {
      state.colorMode = e.target.value;
      renderAll();
    });

    // Sync panning with mouse drag on canvases
    let isDragging = false;
    let dragStartX = 0;
    let dragStartPan = 0;

    function startDrag(e) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartPan = state.panOffset;
    }

    function doDrag(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      // Convert pixel delta to meters delta
      const dMeters = dx / state.zoom;
      state.panOffset = Math.max(0, Math.min(state.maxDistance - els.canvasPrev.width / state.zoom, dragStartPan - dMeters));
      renderAll();
    }

    function stopDrag() {
      isDragging = false;
    }

    // Prev canvas drag listeners
    els.canvasPrev.addEventListener('mousedown', startDrag);
    els.canvasPrev.addEventListener('mousemove', (e) => {
      if (isDragging) doDrag(e);
      else handleCanvasMouseMove(e, 'prev');
    });
    els.canvasPrev.addEventListener('mouseleave', () => {
      state.hoverDist = null;
      state.hoverClockRatio = null;
      els.floatTooltip.style.display = 'none';
      renderAll();
    });

    // Lat canvas drag listeners
    els.canvasLat.addEventListener('mousedown', startDrag);
    els.canvasLat.addEventListener('mousemove', (e) => {
      if (isDragging) doDrag(e);
      else handleCanvasMouseMove(e, 'lat');
    });
    els.canvasLat.addEventListener('mouseleave', () => {
      state.hoverDist = null;
      state.hoverClockRatio = null;
      els.floatTooltip.style.display = 'none';
      renderAll();
    });

    window.addEventListener('mouseup', stopDrag);

    // Zoom synchronously with mouse scroll wheel
    function handleWheelZoom(e) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      
      // Aligned distance under mouse before zoom
      const prevM = getDistanceForX(mouseX, e.currentTarget.width);

      // Apply zoom around mouse pointer
      zoomAroundAnchor(zoomFactor, prevM, mouseX);

      // Re-evaluate hover hit-test at the current mouse position
      const runType = e.currentTarget.id === 'canvasPrev' ? 'prev' : 'lat';
      handleCanvasMouseMove(e, runType);
    }

    els.canvasPrev.addEventListener('wheel', handleWheelZoom, { passive: false });
    els.canvasLat.addEventListener('wheel', handleWheelZoom, { passive: false });

    // Canvas click selector (distinguishes quick clicks from drags to select defects)
    function handleCanvasClick(e, runType) {
      if (Math.abs(e.clientX - dragStartX) > 5) return; // Ignore drag end

      const canvas = runType === 'prev' ? els.canvasPrev : els.canvasLat;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const clickedDist = getDistanceForX(x, canvas.width);
      const clickedClockRatio = getClockRatioForY(y, canvas.height);

      const defects = runType === 'prev' ? state.alignedPrevDefects : state.latDefects;
      let hitDefect = null;
      const thresholdM = Math.max(0.15, 15 / state.zoom);
      const thresholdClock = 0.05;

      defects.forEach(def => {
        const defDist = runType === 'prev' ? def.alignedDistance : def.distance;
        const dX = Math.abs(clickedDist - defDist);
        const dY = getClockRatioDiff(clickedClockRatio, def.clockRatio);

        if (dX <= thresholdM && dY <= thresholdClock) {
          hitDefect = def;
        }
      });

      if (hitDefect) {
        setSelectedDefect(hitDefect.id);
      }
    }

    els.canvasPrev.addEventListener('click', (e) => handleCanvasClick(e, 'prev'));
    els.canvasLat.addEventListener('click', (e) => handleCanvasClick(e, 'lat'));

    // Minimap click & drag to scroll
    let isMinimapDragging = false;
    function handleMinimapClick(e) {
      const rect = els.canvasMinimap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      const viewWidth = els.canvasPrev.width / state.zoom;
      state.panOffset = Math.max(0, Math.min(state.maxDistance - viewWidth, ratio * state.maxDistance - viewWidth / 2));
      renderAll();
    }
    els.canvasMinimap.addEventListener('mousedown', (e) => {
      isMinimapDragging = true;
      handleMinimapClick(e);
    });
    els.canvasMinimap.addEventListener('mousemove', (e) => {
      if (isMinimapDragging) handleMinimapClick(e);
    });
    window.addEventListener('mouseup', () => {
      isMinimapDragging = false;
    });

    // Table Search and Filters
    els.tableSearch.addEventListener('input', () => {
      state.defectCurrentPage = 1;
      fillComparisonTable();
    });
    els.filterStatus.addEventListener('change', () => {
      state.defectCurrentPage = 1;
      fillComparisonTable();
    });

    // Weld Table Search and Filters
    els.weldSearch.addEventListener('input', () => {
      state.weldCurrentPage = 1;
      fillWeldAlignmentTable();
    });
    els.filterWeldStatus.addEventListener('change', () => {
      state.weldCurrentPage = 1;
      fillWeldAlignmentTable();
    });

    // Pagination buttons event listeners
    const btnDefectPrev = document.getElementById('btnDefectPrev');
    const btnDefectNext = document.getElementById('btnDefectNext');
    if (btnDefectPrev && btnDefectNext) {
      btnDefectPrev.addEventListener('click', () => {
        if (state.defectCurrentPage > 1) {
          state.defectCurrentPage--;
          fillComparisonTable();
        }
      });
      btnDefectNext.addEventListener('click', () => {
        state.defectCurrentPage++;
        fillComparisonTable();
      });
    }

    const btnWeldPrev = document.getElementById('btnWeldPrev');
    const btnWeldNext = document.getElementById('btnWeldNext');
    if (btnWeldPrev && btnWeldNext) {
      btnWeldPrev.addEventListener('click', () => {
        if (state.weldCurrentPage > 1) {
          state.weldCurrentPage--;
          fillWeldAlignmentTable();
        }
      });
      btnWeldNext.addEventListener('click', () => {
        state.weldCurrentPage++;
        fillWeldAlignmentTable();
      });
    }

    // Focus row action delegation
    els.defectTableBody.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-table-focus')) {
        const id = e.target.getAttribute('data-id');
        setSelectedDefect(id);
      }
    });

    els.weldTableBody.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-weld-focus')) {
        const dist = parseFloat(e.target.getAttribute('data-dist'));
        if (!isNaN(dist)) {
          // Center view on this distance
          const viewWidth = els.canvasPrev.width / state.zoom;
          state.panOffset = Math.max(0, dist - viewWidth / 2);
          renderAll();
        }
      }
    });

    // Tab toggling logic
    els.tabDefects.addEventListener('click', () => {
      els.tabDefects.classList.add('active');
      els.tabWelds.classList.remove('active');
      els.paneDefects.classList.add('active');
      els.paneWelds.classList.remove('active');
      fillComparisonTable();
    });

    els.tabWelds.addEventListener('click', () => {
      els.tabWelds.classList.add('active');
      els.tabDefects.classList.remove('active');
      els.paneWelds.classList.add('active');
      els.paneDefects.classList.remove('active');
      fillWeldAlignmentTable();
    });

    // Modal Actions
    els.btnModalClose.addEventListener('click', () => els.mappingModal.classList.remove('active'));
    els.btnCancelMapping.addEventListener('click', () => els.mappingModal.classList.remove('active'));
    els.btnApplyMapping.addEventListener('click', applyColumnMapping);

    // Reset All Data
    els.btnReset.addEventListener('click', resetAllData);

    // Load Demo Data
    els.btnLoadDemo.addEventListener('click', loadDemoData);

    // Download CSV template
    els.btnDownloadTemplate.addEventListener('click', downloadCsvTemplate);

    // Resize listener
    window.addEventListener('resize', resizeCanvases);

    // Diagnostics / Unit Test runner
    els.testRunnerBadge.addEventListener('click', runDiagnosticsTests);

    // Theme Toggle
    els.btnThemeToggle.addEventListener('click', toggleTheme);
  }

  const sunPath = "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M12 2v2 M12 20v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M2 12h2 M20 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42";
  const moonPath = "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z";

  function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeIcon(isLight);
    renderAll();
  }

  function updateThemeIcon(isLight) {
    const iconPath = document.getElementById('themeIconPath');
    if (iconPath) {
      iconPath.setAttribute('d', isLight ? moonPath : sunPath);
    }
  }

  function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const isLight = savedTheme === 'light' || (savedTheme === null && systemPrefersLight);
    
    if (isLight) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    updateThemeIcon(isLight);
  }

  function isLightTheme() {
    return document.body.classList.contains('light-theme');
  }

  function resetAllData() {
    state.prevRawData = null;
    state.latRawData = null;
    state.prevWelds = [];
    state.prevDefects = [];
    state.prevLandmarks = [];
    state.latWelds = [];
    state.latDefects = [];
    state.latLandmarks = [];
    state.weldMatches = [];
    state.alignedPrevDefects = [];
    state.alignedPrevLandmarks = [];
    state.alignedPrevWelds = [];
    state.matchedDefects = [];
    state.unmatchedPrev = [];
    state.unmatchedLat = [];
    state.selectedDefectId = null;
    state.panOffset = 0;
    state.defectCurrentPage = 1;
    state.weldCurrentPage = 1;
    
    els.namePrev.textContent = 'No file selected';
    els.nameLat.textContent = 'No file selected';
    els.statusPrev.textContent = 'Not Loaded';
    els.statusPrev.className = 'status-indicator';
    els.statusLat.textContent = 'Not Loaded';
    els.statusLat.className = 'status-indicator';

    updateStatsDashboard();
    renderAll();

    els.defectTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-table-msg">Upload Previous & Latest ILI data files or load Demo Data to begin.</td>
      </tr>
    `;

    els.weldTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-table-msg">Upload Previous & Latest ILI data files or load Demo Data to begin.</td>
      </tr>
    `;

    els.weldSearch.value = '';
    els.filterWeldStatus.value = 'all';

    // Reset recalculate button state
    state.needsRecalculate = false;
    if (els.btnRecalculate) {
      els.btnRecalculate.classList.remove('btn-warning-pulse');
      els.btnRecalculate.disabled = true;
      els.btnRecalculate.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right: 0.25rem;">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
        Recalculate Alignment
      `;
    }
  }

  function loadDemoData() {
    resetAllData();
    
    state.diameter = parseFloat(els.inputOD.value) || 762;
    const nominalJoint = parseFloat(els.inputJointLength.value) || 12;

    const { previousLogs, latestLogs } = window.generateMockLogs(state.diameter, nominalJoint, 300);

    // Split logs into Welds vs Defects
    previousLogs.forEach(l => {
      if (l.type === 'Weld') state.prevWelds.push(l);
      else {
        state.prevDefects.push({
          ...l,
          clockRatio: parseClockToRatio(l.clock)
        });
      }
    });

    latestLogs.forEach(l => {
      if (l.type === 'Weld') state.latWelds.push(l);
      else {
        state.latDefects.push({
          ...l,
          clockRatio: parseClockToRatio(l.clock)
        });
      }
    });

    // Populate joint lengths for mock welds
    fillWeldJointLengths(state.prevWelds, '__none__');
    fillWeldJointLengths(state.latWelds, '__none__');

    els.namePrev.textContent = 'demo_previous_ili.csv (Mock)';
    els.statusPrev.textContent = `Loaded: ${state.prevWelds.length} welds, ${state.prevDefects.length} defects`;
    els.statusPrev.className = 'status-indicator loaded';

    els.nameLat.textContent = 'demo_latest_ili.csv (Mock)';
    els.statusLat.textContent = `Loaded: ${state.latWelds.length} welds, ${state.latDefects.length} defects`;
    els.statusLat.className = 'status-indicator loaded';

    processDataAndAlign();

    // Zoom fit after loading
    const W = els.canvasPrev.width;
    state.zoom = W / state.maxDistance;
    renderAll();
  }

  function downloadCsvTemplate() {
    const csvContent = 
      "Distance (m),Feature Type,Joint ID,Clock Position,Depth (%),Length (mm),Width (mm),Wall Thickness (mm),Joint Length (m),U/S Weld Distance (m)\n" +
      "-0.16,Weld,GW-0,,,,,12.7,0.16,\n" +
      "0.00,Flange,GW-0,12:00,,,,12.7,11.5,\n" +
      "0.15,Weld,GW-1,,,,,12.7,1.60,\n" +
      "0.43,Bend,GW-1,06:00,,,,17.5,1.60,\n" +
      "1.74,Weld,GW-2,,,,,17.5,0.60,\n" +
      "5.30,Defect,GW-5,05:02,23.0,172,196,17.5,0.50,0.52\n" +
      "5.50,Defect,GW-5,05:20,9.0,108,63,17.5,0.50,0.72\n" +
      "5.53,Defect,GW-5,06:48,8.0,14,8,17.5,0.50,0.75\n" +
      "5.64,Weld,GW-6,,,,,17.5,1.40,\n";
      
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ili_log_template.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Diagnostics / Unit Tests Runner ---
  function runDiagnosticsTests() {
    const results = [];
    let passed = 0;
    let failed = 0;

    function assert(name, condition) {
      if (condition) {
        results.push(`✅ PASS: ${name}`);
        passed++;
      } else {
        results.push(`❌ FAIL: ${name}`);
        failed++;
      }
    }

    // Test 1: Clock Ratio conversion
    const c1 = parseClockToRatio('12:00');
    assert('12:00 clock ratio should be 0.0', Math.abs(c1 - 0.0) < 0.001 || Math.abs(c1 - 1.0) < 0.001);

    const c2 = parseClockToRatio('06:00');
    assert('06:00 clock ratio should be 0.5', Math.abs(c2 - 0.5) < 0.001);

    const c3 = parseClockToRatio('03:30');
    assert('03:30 clock ratio should be 0.291', Math.abs(c3 - (210/720)) < 0.001);

    const c4 = parseClockToRatio('9.5');
    assert('Decimal 9.5 clock ratio should represent 09:30', Math.abs(c4 - (570/720)) < 0.001);

    // Test 2: Clock ratio translation back to string
    assert('0.5 ratio should format to 06:00', ratioToClockStr(0.5) === '06:00');
    assert('0.25 ratio should format to 03:00', ratioToClockStr(0.25) === '03:00');

    // Test 3: Weld matching sequence alignment DP
    const weldsP = [
      { id: 'W-0', distance: 0 },
      { id: 'W-1', distance: 12.0 },
      { id: 'W-2', distance: 24.2 }
    ];
    // Introduce a slight shift/drift and a minor perturbation
    const weldsL = [
      { id: 'W-0', distance: 0 },
      { id: 'W-1', distance: 12.1 },
      { id: 'W-2', distance: 24.1 }
    ];
    const alignment = alignWelds(weldsP, weldsL);
    assert('Weld alignment path should align all 3 welds', alignment.path.filter(p => p.type === 'match').length === 3);

    // Test 4: Stretch-and-Squeeze local mapping
    // If a defect is exactly in the middle of joint 1 in Previous, it should map to the middle of joint 1 in Latest
    const mappedD = mapPrevDistanceToLat(6.0, weldsP, weldsL, alignment.path, alignment.scale);
    assert('Defect at 6.0m (middle of 0-12m) should map to 6.05m (middle of 0-12.1m)', Math.abs(mappedD - 6.05) < 0.001);

    // Test 5: Circular clock difference
    assert('Diff between 11:30 and 12:30 (0.5h difference) should be 30 min', Math.abs(getClockRatioDiff(parseClockToRatio('11:30'), parseClockToRatio('12:30')) * 720 - 60) < 0.001);

    // Test 6: Missing weld and odometer start shift (User's specific scenario)
    const userWeldsP = [
      { id: 'GW-120', distance: 7.127, jointLength: 4.52 },
      { id: 'GW-130', distance: 11.647, jointLength: 2.6 },
      { id: 'GW-140', distance: 14.247, jointLength: 5.31 },
      { id: 'GW-160', distance: 23.443, jointLength: 7.26 }
    ];
    const userWeldsL = [
      { id: 'GW-80', distance: 5.795, jointLength: 4.133 },
      { id: 'GW-90', distance: 9.928, jointLength: 2.548 },
      { id: 'GW-100', distance: 12.476, jointLength: 5.208 },
      { id: 'GW-110', distance: 17.684, jointLength: 3.885 },
      { id: 'GW-120', distance: 21.569, jointLength: 7.329 }
    ];

    const oldTolerance = state.tolerance;
    const oldNominal = state.nominalJointLength;
    state.tolerance = 15; // 15% tolerance
    state.nominalJointLength = 6.0; // nominal joint length for this test is around 5-6m

    const userAlignment = alignWelds(userWeldsP, userWeldsL);
    
    // Restore state
    state.tolerance = oldTolerance;
    state.nominalJointLength = oldNominal;

    const matchedPairsUser = userAlignment.path.filter(p => p.type === 'match');
    assert('User scenario: should find exactly 4 matches', matchedPairsUser.length === 4);
    
    if (matchedPairsUser.length === 4) {
      assert('User scenario: GW-120 should match GW-80', matchedPairsUser[0].idxPrev === 0 && matchedPairsUser[0].idxLat === 0);
      assert('User scenario: GW-130 should match GW-90', matchedPairsUser[1].idxPrev === 1 && matchedPairsUser[1].idxLat === 1);
      assert('User scenario: GW-140 should match GW-100', matchedPairsUser[2].idxPrev === 2 && matchedPairsUser[2].idxLat === 2);
      assert('User scenario: GW-160 should match GW-120', matchedPairsUser[3].idxPrev === 3 && matchedPairsUser[3].idxLat === 4);
    }

    // Test 7: Binary Search helper
    const sortedData = [
      { d: 5.0 }, { d: 10.0 }, { d: 15.0 }, { d: 20.0 }, { d: 25.0 }
    ];
    assert('binarySearchFirstIndex should find element >= 10.0 at index 1', binarySearchFirstIndex(sortedData, x => x.d, 10.0) === 1);
    assert('binarySearchFirstIndex should find element >= 12.0 at index 2 (15.0)', binarySearchFirstIndex(sortedData, x => x.d, 12.0) === 2);
    assert('binarySearchFirstIndex should return index 0 for value <= 5.0', binarySearchFirstIndex(sortedData, x => x.d, 2.0) === 0);
    assert('binarySearchFirstIndex should return length for value > 25.0', binarySearchFirstIndex(sortedData, x => x.d, 30.0) === sortedData.length);
    assert('binarySearchFirstIndex should handle empty arrays', binarySearchFirstIndex([], x => x.d, 5.0) === 0);

    // Print summary
    alert(`Diagnostics Results:\n\n${results.join('\n')}\n\nSummary: ${passed} passed, ${failed} failed.`);
  }

  // Run initial loading
  window.addEventListener('DOMContentLoaded', init);
})();
