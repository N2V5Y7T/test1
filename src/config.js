/**
 * The Nines — Section Configuration Builder
 *
 * Loads manifest.json + menu.json, computes per-section layout data:
 * scroll heights, frame paths, hold frames, choreography timing.
 */

export const CHOREOGRAPHY = {
  // Entrance
  categoryStart:      0.0,    // Start immediately
  categoryRiseEnd:    0.50,   // Glide smoothly over the entrance scroll
  menuStart:          0.10,   // Menu starts fading in right after category
  holdAt:             0.50,   // Finish entrance when video hits holdFrame

  // Exit & Handoff (calibrated for seamless continuous flow into next section/group)
  exitVideoResumeAt:  0.35,   // fraction of exit segment where video resumes
  exitLengthVh:       30,     // responsive upward exit so user flows quickly into the next section
  handoffLengthVh:    18,     // smooth cross-dissolve into next section/group without dead scroll
};

// Estimate menu height in px from item count (refined in Phase 3 with real DOM)
function estimateMenuHeight(section) {
  const ITEM_HEIGHT = 85;
  const SUBHEADER_HEIGHT = 50;
  const HEADER_HEIGHT = 60;
  const PADDING = 100;

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
 * Returns an array of section objects in one continuous scroll stream
 * (Food -> Bar -> Beverages).
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
    if (group.video && Object.prototype.hasOwnProperty.call(manifest, group.key)) {
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
        scrubLengthVh: 105,
        estimatedMenuHeightPx: 0,
        hasMenu: false,
        placeholderBytes: m.placeholderBytes,
      });
    }

    // Regular sections in continuous order across all groups
    for (const sec of group.sections) {
      if (!Object.prototype.hasOwnProperty.call(manifest, sec.key)) {
        console.warn(`[Config] No manifest entry for section: ${sec.key}`);
        continue;
      }
      const m = manifest[sec.key];

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
        scrubLengthVh: 115, // Snappy, continuous scrub rate between sections and groups
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

const NON_VEG_OPTION_RE = /\b(chicken|prawn|prawns|mutton|lamb|fish|egg|eggs|crab|salmon|seafood|meat|pork|beef|keema)\b/i;
const EGG_TEXT_RE = /\b(egg|eggs|omelette)\b/i; // Note: \begg\b matches "egg" but NOT "eggless" (so Eggless Tres Leches stays!)

function filterItemForPureVeg(item) {
  if (!item) return null;
  if (item.diet === 'nonveg' || item.diet === 'egg') return null;
  const fullText = `${item.name || ''} ${item.desc || ''} ${item.note || ''}`;
  if (EGG_TEXT_RE.test(fullText)) return null;

  if (Array.isArray(item.options) && item.options.length > 0) {
    const filteredOptions = item.options.filter(opt => {
      if (opt.diet === 'nonveg' || opt.diet === 'egg') return false;
      const optText = `${opt.label || ''} ${opt.desc || ''}`;
      return !NON_VEG_OPTION_RE.test(optText);
    });

    if (filteredOptions.length === 0) return null;

    return {
      ...item,
      options: filteredOptions.map(o => ({ ...o })),
      hadMultipleOptions: item.options.length > 1,
    };
  }

  return { ...item };
}

/**
 * Filter sections for Pure Veg mode dynamically in memory.
 * Preserves masterSections untouched so toggling Pure Veg restores the entire menu instantaneously.
 */
export function filterSectionsForPureVeg(masterSections, isPureVeg) {
  if (!isPureVeg) {
    return masterSections.map((sec, idx) => ({
      ...sec,
      index: idx,
      measuredHeightPx: undefined,
      items: sec.items ? sec.items.map(it => ({ ...it, options: it.options ? it.options.map(o => ({ ...o })) : it.options })) : null,
      subgroups: sec.subgroups ? sec.subgroups.map(sg => ({
        ...sg,
        items: sg.items.map(it => ({ ...it, options: it.options ? it.options.map(o => ({ ...o })) : it.options }))
      })) : null,
    }));
  }

  const result = [];

  for (const sec of masterSections) {
    // Non-food groups or group-intro stay intact
    if (sec.groupKey !== 'food' || sec.type === 'group-intro') {
      result.push({
        ...sec,
        measuredHeightPx: undefined,
        items: sec.items ? sec.items.map(it => ({ ...it, options: it.options ? it.options.map(o => ({ ...o })) : it.options })) : null,
        subgroups: sec.subgroups ? sec.subgroups.map(sg => ({
          ...sg,
          items: sg.items.map(it => ({ ...it, options: it.options ? it.options.map(o => ({ ...o })) : it.options }))
        })) : null,
      });
      continue;
    }

    // Food section with subgroups
    if (sec.subgroups && Array.isArray(sec.subgroups)) {
      const keptSubgroups = [];
      for (const sg of sec.subgroups) {
        const filteredItems = sg.items ? sg.items.map(filterItemForPureVeg).filter(Boolean) : [];
        if (filteredItems.length > 0) {
          keptSubgroups.push({
            ...sg,
            items: filteredItems,
          });
        }
      }
      if (keptSubgroups.length === 0) {
        // Drop section entirely if no items remain
        continue;
      }
      const cloned = {
        ...sec,
        subgroups: keptSubgroups,
        measuredHeightPx: undefined,
      };
      cloned.estimatedMenuHeightPx = estimateMenuHeight(cloned);
      result.push(cloned);
    } else if (sec.items && Array.isArray(sec.items)) {
      const filteredItems = sec.items.map(filterItemForPureVeg).filter(Boolean);
      if (filteredItems.length === 0) {
        // Drop section entirely (e.g. nonveg-starters, nonveg-mains)
        continue;
      }
      const cloned = {
        ...sec,
        items: filteredItems,
        measuredHeightPx: undefined,
      };
      cloned.estimatedMenuHeightPx = estimateMenuHeight(cloned);
      result.push(cloned);
    }
  }

  return result.map((sec, idx) => ({
    ...sec,
    index: idx,
  }));
}

/**
 * Compute scroll layout for all sections.
 * Returns section objects augmented with absolute scroll positions (in px).
 *
 * @param {Array} sections - from buildSectionConfig()
 * @param {number} vh - viewport height in px
 */
export function computeScrollLayout(sections, vh) {
  let scrollOffset = 0;

  return sections.map((sec, index) => {
    const isGroupIntro = sec.type === 'group-intro';
    const isLast = index === sections.length - 1;
    const handoffPx = (CHOREOGRAPHY.handoffLengthVh / 100) * vh;
    const scrubPx = (sec.scrubLengthVh / 100) * vh;

    if (isGroupIntro) {
      const A_length = scrubPx;
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

    const A_length = holdP * scrubPx;

    const H_length = sec.hasMenu
      ? (sec.measuredHeightPx !== undefined ? sec.measuredHeightPx : sec.estimatedMenuHeightPx)
      : 0;

    const X_length = exitPx;

    const X_videoResumeScroll = (1 - CHOREOGRAPHY.exitVideoResumeAt) * X_length;
    const p_covered_in_X = X_videoResumeScroll / scrubPx;

    const remaining_p = Math.max(0, 1.0 - holdP - p_covered_in_X);
    const C_length = isLast
      ? Math.max(remaining_p * scrubPx, 0.70 * vh)
      : remaining_p * scrubPx;

    const J_length = isLast ? 0 : handoffPx;

    const totalHeight = A_length + H_length + X_length + C_length + J_length;

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

      p_at_hold: holdP,
      p_at_exit_end: holdP + p_covered_in_X,
      p_covered_in_X,
    };

    scrollOffset += totalHeight;
    return layout;
  });
}
