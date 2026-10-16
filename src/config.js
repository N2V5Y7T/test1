/**
 * The Nines — Section Configuration Builder
 * 
 * Loads manifest.json + menu.json, computes per-section layout data:
 * scroll heights, frame paths, hold frames, choreography timing.
 */

// Default choreography values (from the-nines-animation-choreography.md)
export const CHOREOGRAPHY = {
  // Entrance (spread out for much smoother emergence)
  categoryStart:      0.0,    // Start immediately
  categoryRiseEnd:    0.50,   // Glide smoothly over the entire entrance scroll
  menuStart:          0.10,   // Menu starts fading in right after category
  holdAt:             0.50,   // Finish entrance when video hits holdFrame
  
  // Exit
  exitVideoResumeAt:  0.40,   // fraction of exit segment where video resumes
  exitLengthVh:       40,     // exit segment scroll length in vh (responsive and clean)
  handoffLengthVh:    22,     // cross-dissolve length in vh (smooth quick crossfade)
};

// Estimate menu height in px from item count (refined in Phase 3 with real DOM)
function estimateMenuHeight(section) {
  const ITEM_HEIGHT = 85;       // px per item (name + desc + price row)
  const SUBHEADER_HEIGHT = 50;  // px per subgroup header
  const HEADER_HEIGHT = 60;     // category header
  const PADDING = 100;          // top/bottom padding

  let count = 0;
  let subheaders = 0;
  if (section.items) {
    count = section.items.length;
  } else if (section.subgroups) {
    subheaders = section.subgroups.length;
    count = section.subgroups.reduce((s, sg) => s + sg.items.length, 0);
  }

  return HEADER_HEIGHT + PADDING + count * ITEM_HEIGHT + subheaders * SUBHEADER_HEIGHT;
}

/**
 * Build complete section config from manifest + menu data.
 * Returns an array of section objects in scroll order.
 */
export async function buildSectionConfig() {
  const [manifestRes, menuRes] = await Promise.all([
    fetch('./frames/manifest.json'),
    fetch('./assets/menu/the-nines-menu.json'),
  ]);
  if (!manifestRes.ok) throw new Error(`Failed to load manifest: ${manifestRes.status}`);
  if (!menuRes.ok) throw new Error(`Failed to load menu: ${menuRes.status}`);
  const manifest = await manifestRes.json();
  const menu = await menuRes.json();

  const sections = [];

  for (const group of menu.groups) {
    // Group intro video (e.g. food.mp4)
    if (group.video && manifest[group.key]) {
      const m = manifest[group.key];
      sections.push({
        key: group.key,
        label: group.label,
        type: 'group-intro',
        groupKey: group.key,
        framePath: `./frames/${group.key}/`,
        frameCount: m.frameCount,
        holdFrame: null,
        holdP: 1.0,
        scrubLengthVh: 110,   // calibrated for smooth, effortless 78-frame intro sequence
        estimatedMenuHeightPx: 0,  // no menu items in group intro
        hasMenu: false,
        placeholderBytes: m.placeholderBytes,
      });
    }

    // Regular sections
    for (const sec of group.sections) {
      const m = manifest[sec.key];
      if (!m) {
        console.warn(`[Config] No manifest entry for section: ${sec.key}`);
        continue;
      }

      const holdP = sec.holdFrame != null
        ? sec.holdFrame / m.frameCount
        : m.holdFrame / m.frameCount;

      sections.push({
        key: sec.key,
        label: sec.label,
        type: 'section',
        groupKey: group.key,
        groupLabel: group.label,
        framePath: `./frames/${sec.key}/`,
        frameCount: m.frameCount,
        holdFrame: sec.holdFrame ?? m.holdFrame,
        holdP,
        scrubLengthVh: 140, // Standardized across all regular sections: eliminates wild 100vh-700vh speed fluctuations
        estimatedMenuHeightPx: estimateMenuHeight(sec),
        hasMenu: true,
        items: sec.items || null,
        subgroups: sec.subgroups || null,
        note: sec.note || null,
        placeholderBytes: m.placeholderBytes,
      });
    }
  }

  return sections;
}

/**
 * Compute scroll layout for all sections.
 * Returns section objects augmented with absolute scroll positions (in px).
 *
 * @param {Array} sections - from buildSectionConfig()
 * @param {number} vh - viewport height in px
 */
export function computeScrollLayout(sections, vh) {
  let scrollOffset = 0;  // current absolute scroll position

  return sections.map((sec, index) => {
    const isGroupIntro = sec.type === 'group-intro';
    const isLast = index === sections.length - 1;
    const handoffPx = (CHOREOGRAPHY.handoffLengthVh / 100) * vh;
    const scrubPx = (sec.scrubLengthVh / 100) * vh;

    if (isGroupIntro) {
      // Standalone continuous intro:
      // Video scrubs continuously from frame 0 to end (p: 0.0 -> 1.0)
      // Never freezes or holds. Transitions smoothly via Segment J cross-dissolve.
      const A_length = scrubPx;
      const H_length = 0;
      const X_length = 0;
      const C_length = 0;
      const J_length = isLast ? 0 : handoffPx;
      const totalHeight = A_length + J_length;

      const layout = {
        ...sec,
        index,
        scrollStart: scrollOffset,
        scrollEnd: scrollOffset + totalHeight,
        totalHeight,

        A_start: scrollOffset,
        A_end: scrollOffset + A_length,
        A_length,

        H_start: scrollOffset + A_length,
        H_end: scrollOffset + A_length,
        H_length: 0,

        X_start: scrollOffset + A_length,
        X_end: scrollOffset + A_length,
        X_length: 0,
        X_videoResumeAt: scrollOffset + A_length,

        C_start: scrollOffset + A_length,
        C_end: scrollOffset + A_length,
        C_length: 0,

        J_start: scrollOffset + A_length,
        J_end: scrollOffset + totalHeight,
        J_length,

        p_at_hold: 1.0,
        p_at_exit_end: 1.0,
        p_covered_in_X: 0,
      };

      scrollOffset += totalHeight;
      return layout;
    }

    const holdP = sec.holdP;
    const exitPx = (CHOREOGRAPHY.exitLengthVh / 100) * vh;

    // Segment A: video scrubs from p=0 to p=holdP
    const A_length = holdP * scrubPx;

    // Segment H: video frozen, menu scrolls
    // H_length matches the actual distance needed to scroll the dishes.
    // If all items fit on screen (measuredHeightPx === 0), H_length is 0 so there is no dead frozen scroll!
    const H_length = sec.hasMenu 
      ? (sec.measuredHeightPx !== undefined ? sec.measuredHeightPx : sec.estimatedMenuHeightPx) 
      : 0;

    // Segment X: exit (exitLengthVh)
    const X_length = exitPx;

    // Video progress covered during X's resume phase
    // Rate matches A: 1 unit of p per scrubPx of scroll
    // Resume starts at exitVideoResumeAt fraction of X
    const X_videoResumeScroll = (1 - CHOREOGRAPHY.exitVideoResumeAt) * X_length;
    const p_covered_in_X = X_videoResumeScroll / scrubPx;

    // Segment C: remaining video progress
    const remaining_p = Math.max(0, 1.0 - holdP - p_covered_in_X);
    const C_length = remaining_p * scrubPx;

    // Segment J: cross-dissolve (skip for last section)
    const J_length = isLast ? 0 : handoffPx;

    const totalHeight = A_length + H_length + X_length + C_length + J_length;

    const layout = {
      ...sec,
      index,
      scrollStart: scrollOffset,
      scrollEnd: scrollOffset + totalHeight,
      totalHeight,

      // Segment boundaries (absolute scroll positions)
      A_start: scrollOffset,
      A_end: scrollOffset + A_length,
      A_length,

      H_start: scrollOffset + A_length,
      H_end: scrollOffset + A_length + H_length,
      H_length,

      X_start: scrollOffset + A_length + H_length,
      X_end: scrollOffset + A_length + H_length + X_length,
      X_length,
      X_videoResumeAt: scrollOffset + A_length + H_length + CHOREOGRAPHY.exitVideoResumeAt * X_length,

      C_start: scrollOffset + A_length + H_length + X_length,
      C_end: scrollOffset + A_length + H_length + X_length + C_length,
      C_length,

      J_start: scrollOffset + A_length + H_length + X_length + C_length,
      J_end: scrollOffset + totalHeight,
      J_length,

      // Pre-computed p values
      p_at_hold: holdP,
      p_at_exit_end: holdP + p_covered_in_X,
      p_covered_in_X,
    };

    scrollOffset += totalHeight;
    return layout;
  });
}




