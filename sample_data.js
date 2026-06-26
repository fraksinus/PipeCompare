/**
 * sample_data.js
 * Generates synthetic ILI logs for Previous and Latest runs to allow immediate visualization.
 */

function generateMockLogs(diameterMm = 762, nominalJointLengthM = 12, totalLengthM = 300) {
  const previousLogs = [];
  const latestLogs = [];

  // 1. Generate Girth Welds
  let prevWeldDistance = 0;
  let latWeldDistance = 0;
  const numJoints = Math.ceil(totalLengthM / nominalJointLengthM);

  const prevWelds = [];
  const latWelds = [];

  for (let i = 0; i <= numJoints; i++) {
    // Previous Run Welds
    prevWelds.push({
      id: `GW-${i}`,
      distance: prevWeldDistance,
      type: 'Weld'
    });

    // Latest Run Welds (introduce odometer drift and minor local variations)
    // Cumulative drift is about 0.08% overall, plus local random perturbations up to 0.1m
    const localDrift = (Math.random() - 0.5) * 0.08;
    const accumDrift = prevWeldDistance * 0.0006; // Odometer scaling
    latWelds.push({
      id: `GW-${i}`,
      distance: latWeldDistance,
      type: 'Weld'
    });

    // Next step
    const nextJointLengthPrev = nominalJointLengthM + (Math.random() - 0.5) * 0.2;
    // Odometer tolerance might measure the joint length slightly differently (e.g. up to 10% tolerance is allowed in user settings, we'll keep it within 2% normal deviation)
    const nextJointLengthLat = nextJointLengthPrev * 1.0008 + (Math.random() - 0.5) * 0.15;

    prevWeldDistance += nextJointLengthPrev;
    latWeldDistance += nextJointLengthLat;
  }

  // Add Welds to logs
  previousLogs.push(...prevWelds);
  latestLogs.push(...latWelds);

  // Helper to format clock position
  function formatClock(hours, minutes) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  // 2. Generate Defects
  // We place defects relative to the joint index to ensure we can match them using the stretch-and-squeeze algorithm
  const defectTemplates = [
    { jointIndex: 2, relDist: 0.35, clock: [3, 0], depthPrev: 15, depthLat: 18, lenPrev: 20, lenLat: 22, widPrev: 15, widLat: 16, desc: 'Corrosion at 3 o\'clock' },
    { jointIndex: 4, relDist: 0.82, clock: [6, 15], depthPrev: 22, depthLat: 29, lenPrev: 35, lenLat: 42, widPrev: 30, widLat: 32, desc: 'Bottom wall loss' },
    { jointIndex: 7, relDist: 0.15, clock: [11, 45], depthPrev: 8, depthLat: 10, lenPrev: 10, lenLat: 10, widPrev: 12, widLat: 12, desc: 'Minor pit near weld' },
    { jointIndex: 10, relDist: 0.50, clock: [1, 30], depthPrev: 25, depthLat: null, lenPrev: 30, lenLat: null, widPrev: 25, widLat: null, desc: 'Repaired defect (sleeve installed)' }, // Repaired!
    { jointIndex: 14, relDist: 0.65, clock: [9, 15], depthPrev: null, depthLat: 14, lenPrev: null, lenLat: 24, widPrev: null, widLat: 20, desc: 'New metal loss' }, // New Defect!
    { jointIndex: 18, relDist: 0.22, clock: [12, 0], depthPrev: 45, depthLat: 56, lenPrev: 50, lenLat: 58, widPrev: 40, widLat: 44, desc: 'Deep corrosion (Critical)' },
    { jointIndex: 21, relDist: 0.77, clock: [5, 45], depthPrev: 12, depthLat: 15, lenPrev: 18, lenLat: 20, widPrev: 15, widLat: 16, desc: 'Internal erosion' },
    { jointIndex: 23, relDist: 0.40, clock: [8, 30], depthPrev: 30, depthLat: 32, lenPrev: 28, lenLat: 29, widPrev: 22, widLat: 22, desc: 'Mid-body wall loss' },
    { jointIndex: 25, relDist: 0.50, clock: [6, 0], depthPrev: 35, depthLat: 40, lenPrev: Math.round(0.10 * nominalJointLengthM * 1000), lenLat: Math.round(0.10 * nominalJointLengthM * 1000), widPrev: Math.round(0.10 * Math.PI * diameterMm), widLat: Math.round(0.10 * Math.PI * diameterMm), desc: 'Visualizer Test (10% length, 10% width)' }
  ];

  defectTemplates.forEach((t, idx) => {
    if (t.jointIndex >= numJoints) return;

    const prevJointStart = prevWelds[t.jointIndex].distance;
    const prevJointEnd = prevWelds[t.jointIndex + 1].distance;
    const latJointStart = latWelds[t.jointIndex].distance;
    const latJointEnd = latWelds[t.jointIndex + 1].distance;

    // Previous run defect
    if (t.depthPrev !== null) {
      const prevDist = prevJointStart + t.relDist * (prevJointEnd - prevJointStart);
      previousLogs.push({
        id: `DF-${idx + 1}-P`,
        distance: parseFloat(prevDist.toFixed(3)),
        type: 'Defect',
        depth: t.depthPrev,
        length: t.lenPrev,
        width: t.widPrev,
        clock: formatClock(t.clock[0], t.clock[1]),
        description: t.desc
      });
    }

    // Latest run defect (slightly alter clock and relative distance due to measurement tolerances)
    if (t.depthLat !== null) {
      const clockNoiseMin = (Math.random() > 0.5 ? 5 : -5) * (Math.random() > 0.7 ? 1 : 0); // +/- 5 min clock noise
      let latClockMin = t.clock[1] + clockNoiseMin;
      let latClockHour = t.clock[0];
      if (latClockMin < 0) {
        latClockMin += 60;
        latClockHour = (latClockHour - 1 + 12) || 12;
      } else if (latClockMin >= 60) {
        latClockMin -= 60;
        latClockHour = (latClockHour + 1) % 12 || 12;
      }

      // Add a tiny bit of relative distance measurement error (e.g., +/- 0.004)
      const latRelDist = t.relDist + (Math.random() - 0.5) * 0.004;
      const latDist = latJointStart + latRelDist * (latJointEnd - latJointStart);

      latestLogs.push({
        id: `DF-${idx + 1}-L`,
        distance: parseFloat(latDist.toFixed(3)),
        type: 'Defect',
        depth: t.depthLat,
        length: t.lenLat,
        width: t.widLat,
        clock: formatClock(latClockHour, latClockMin),
        description: t.desc
      });
    }
  });

  // Sort logs by distance
  previousLogs.sort((a, b) => a.distance - b.distance);
  latestLogs.sort((a, b) => a.distance - b.distance);

  return { previousLogs, latestLogs };
}

// Make available globally in the browser
window.generateMockLogs = generateMockLogs;
