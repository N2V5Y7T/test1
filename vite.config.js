import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Vite plugin to inject SEO metadata (JSON-LD) and a <noscript> fallback menu
 * generated from the menu.json file at build/dev time.
 */
function seoPlugin() {
  return {
    name: 'the-nines-seo',
    transformIndexHtml(html) {
      const menuPath = path.resolve(__dirname, 'public/assets/menu/the-nines-menu.json');
      if (!fs.existsSync(menuPath)) return html;

      const menuData = JSON.parse(fs.readFileSync(menuPath, 'utf-8'));

      // 1. Generate JSON-LD Schema
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        "name": "The Nines",
        "image": "https://thenines.in/assets/logo-new.png",
        "servesCuisine": ["Modern Indian", "Asian", "European"],
        "hasMenu": {
          "@type": "Menu",
          "name": "The Nines Main Menu",
          "hasMenuSection": []
        }
      };

      // 2. Generate <noscript> fallback HTML for search engines and JS-disabled users
      let noScriptHtml = `<noscript><div id="seo-fallback-menu" style="padding: 24px; font-family: sans-serif;">`;
      noScriptHtml += `<h1>The Nines - Menu</h1>`;

      if (menuData.groups) {
        menuData.groups.forEach(group => {
          noScriptHtml += `<h2>${escapeHtml(group.label)}</h2>`;

          if (group.sections) {
            group.sections.forEach(section => {
              const sectionSchema = {
                "@type": "MenuSection",
                "name": section.label,
                "hasMenuItem": []
              };

              noScriptHtml += `<h3>${escapeHtml(section.label)}</h3>`;
              if (section.note) noScriptHtml += `<p><em>${escapeHtml(section.note)}</em></p>`;

              const processItem = (item) => {
                let price = item.price;
                if (item.options && item.options.length > 0) price = item.options[0].price;
                else if (item.pour30ml != null) price = item.pour30ml;
                else if (item.glass != null) price = item.glass;
                else if (item.bottle != null) price = item.bottle;

                const desc = item.desc || (item.options ? item.options.filter(o => o.desc).map(o => `${o.label}: ${o.desc}`).join(' | ') : '');

                const itemSchema = {
                  "@type": "MenuItem",
                  "name": item.name,
                  "description": desc,
                };

                if (price && price !== 'seasonal') {
                  itemSchema.offers = {
                    "@type": "Offer",
                    "price": price,
                    "priceCurrency": "INR"
                  };
                }

                if (item.diet === 'veg') {
                  itemSchema.suitableForDiet = "https://schema.org/VegetarianDiet";
                } else if (item.diet === 'nonveg') {
                  itemSchema.suitableForDiet = "https://schema.org/RestrictedDiet";
                }

                sectionSchema.hasMenuItem.push(itemSchema);

                noScriptHtml += `<div>`;
                noScriptHtml += `<strong>${escapeHtml(item.name)}</strong>`;
                if (item.diet) noScriptHtml += ` (${escapeHtml(item.diet)})`;
                if (price === 'seasonal') {
                  noScriptHtml += ` - Seasonal`;
                } else if (price != null) {
                  noScriptHtml += ` - INR ${escapeHtml(price)}`;
                }
                if (desc) noScriptHtml += `<p>${escapeHtml(desc)}</p>`;
                noScriptHtml += `</div>`;
              };

              if (section.subgroups) {
                section.subgroups.forEach(sg => {
                  const sgTitle = sg.subHeader || sg.label;
                  if (sgTitle) noScriptHtml += `<h4>${escapeHtml(sgTitle)}</h4>`;
                  if (sg.items) sg.items.forEach(processItem);
                });
              } else if (section.items) {
                section.items.forEach(processItem);
              }

              jsonLd.hasMenu.hasMenuSection.push(sectionSchema);
            });
          }
        });
      }

      noScriptHtml += `<div style="text-align: center; margin-top: 36px; padding: 20px 0;"><h2>Thank You</h2><p>The Nines</p></div>`;
      noScriptHtml += `</div></noscript>`;

      // Escape '<' as '\u003c' inside JSON-LD script block to prevent script breakout
      const jsonLdString = JSON.stringify(jsonLd, null, 2).replace(/</g, '\\u003c');
      const jsonLdScript = `<script type="application/ld+json">\n${jsonLdString}\n</script>`;

      let modifiedHtml = html.replace('</head>', `  ${jsonLdScript}\n</head>`);
      modifiedHtml = modifiedHtml.replace('<body>', `<body>\n  ${noScriptHtml}`);

      return modifiedHtml;
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [seoPlugin()],
  server: {
    watch: {
      ignored: ['**/scratch/**', '**/.git/**']
    }
  }
});
