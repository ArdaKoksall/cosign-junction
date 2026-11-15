# Bloub animation engine

Source: https://github.com/jeremy-prt/bloub
Revision: b4bb3c1b5f93c7b87a2e8d620f667c4093d97749
License: MIT, copyright 2026 Jérémy Perret. See LICENSE; the distributed notice is in public/licenses/bloub.txt.

The upstream src/bot TypeScript modules are vendored unchanged. No Vue runtime is included.
../../components/BloubAvatar.tsx adapts the upstream BloubBot.vue SVG renderer to React and supplies a visibility-aware animation clock, pointer following, and reduced-motion handling.
The upstream license covers the code, not the x.ai design it recreates. No affiliation with x.ai is implied.
