# Design System Strategy: The Obsidian Monolith

## 1. Overview & Creative North Star
The Creative North Star for this system is **"The Digital Monolith."** 

This is an exercise in extreme precision, density, and structural integrity. Moving away from the "soft" web of 2024, this system embraces a brutalist, editorial sharpness inspired by high-end markdown editors and developer environments like Linear. We are not building a generic app; we are crafting a professional instrument. 

The aesthetic is defined by **intentional rigidity**. By utilizing a 0px radius across the board and relying on 1px structural demarcations, we create a sense of "engineered" space. The "High-End" feel comes from the meticulous control of whitespace and the high-contrast relationship between the obsidian-dark surfaces and the Tangerine accent.

## 2. Colors & Surface Architecture
While the palette is dark, it is not "flat" in the traditional sense. It is a study in tonal hierarchy.

### The Surface Hierarchy
Depth is achieved through the sequential layering of dark values rather than shadows.
- **Base Layer (`surface` / `#131313`):** The foundation of the workspace. Used for the primary editor area.
- **Navigation Layer (`surface_container_low` / `#1b1b1c`):** Used for primary sidebars to provide a subtle "recession" from the main content.
- **Interactive Layer (`surface_container_high` / `#2a2a2a`):** Used for elevated panels, floating menus, or active states.

### The "Precision Line" Rule
Unlike traditional editorial systems that rely on whitespace alone, this system uses the **1px hairline** (`outline_variant` / `#564335` or `#333333`) to define panels. However, these must be used sparingly. 
- **Rule:** Do not use lines to separate items in a list. Use them only to separate major functional regions (e.g., Sidebar from Editor).
- **The "Ghost" Exception:** For secondary containers, use a 10-20% opacity on the border to ensure the UI feels sharp but not "caged."

### Accents & Tones
- **Primary (`primary` / `#ffb77d`):** Our Tangerine signature. Use this only for "Final Actions" or active focus states.
- **The "Burn" State (`on_tertiary_container` / `#503100`):** Use the deep amber background for text highlighting in markdown to provide a "glow" effect without using actual glows or shadows.

## 3. Typography: The Editorial Engineer
We use **Inter** for its mathematical neutrality. The hierarchy is designed to feel like a technical manual—highly structured and legible.

- **Display & Headlines:** Used for document titles and major headings. These should always be `Semi-bold` (600) to provide a heavy "anchor" to the page.
- **Title-SM to Title-LG:** Used for sidebar categories and panel headers. Use `Medium` (500) to differentiate from body text.
- **Body-MD:** The workhorse. This is the markdown writing layer. Set to `Regular` (400) for maximum long-form legibility.
- **Label-SM:** The "Metadata" layer. Use `Muted Text` (#8A8F98) for timestamps, file sizes, and secondary info.

**Micro-Copy Note:** All labels should be treated with slightly tighter letter-spacing (-0.01em) to enhance the "sharp" Linear-inspired look.

## 4. Elevation & Depth: Tonal Stacking
Shadows are strictly prohibited. In this system, "Elevation" is a misnomer; we use **"Tonal Stacking."**

- **Stacking Logic:** 
    - Level 0: `#131313` (Editor)
    - Level 1: `#1B1B1C` (Sidebar)
    - Level 2: `#202020` (Modals/Popovers)
- **The Ghost Border:** For floating elements like tooltips or command palettes, use a 1px border of `outline` (#a48c7b) at 15% opacity. This creates a "glass edge" effect that defines the object's perimeter against the dark background without the "weight" of a solid line.

## 5. Components

### Buttons
- **Primary:** Background: `primary_container` (#f28500), Text: `on_primary` (#4d2600). 0px border-radius.
- **Secondary:** Background: `transparent`, Border: 1px `outline` (#a48c7b) at 30% opacity. 
- **State Change:** On hover, shift background to `surface_bright` (#393939). No transition easing—interaction should be instantaneous and "mechanical."

### Inputs & Search Bars
- **The "Sharp" Input:** Unlike other components, the search bar may use a subtle `2px` radius to indicate "Global Search." 
- **Active State:** When focused, the 1px border transitions from `#333333` to `primary` (#ffb77d).

### Lists & Navigation items
- **Forbid Dividers:** Do not use lines between list items.
- **Selection:** Use a background shift to `surface_container_highest` (#353535) and a 2px Tangerine vertical "pill" on the far left of the active item.

### The Markdown Code Block
- **Background:** `surface_container_lowest` (#0e0e0e).
- **Typography:** Monospace.
- **Padding:** Use the `4` scale (0.9rem) for internal code block padding to give the code "room to breathe" within the dense UI.

## 6. Do's and Don'ts

### Do
- **Embrace Density:** Use the `2` and `2.5` spacing tokens to keep information compact. This is a pro-tool, not a marketing site.
- **Monochromatic Transitions:** Transition between panels using background colors that are only a few hex points apart.
- **Vertical Rhythm:** Ensure all headers and body text align to a strict baseline grid.

### Don't
- **No Gradients:** Color should be flat and "solid" like stone.
- **No Shadows:** Shadows imply a light source that doesn't exist in this obsidian world.
- **No Rounding:** 0px is the law. Rounding "softens" the intent of the app; we want it to feel like it was cut from glass.
- **No High-Contrast Borders:** Never use white or light grey for borders. Borders are "ghosts"—they are there to guide the eye, not to trap the content.