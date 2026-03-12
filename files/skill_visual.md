# SKILL FILE: VISUAL

## WHEN TO USE THIS SKILL

Use this skill when the request involves:
- Image generation prompts (Midjourney, DALL-E, Stable Diffusion)
- UI/UX design descriptions
- Logo or brand identity briefs
- Photo or illustration directions
- Video or animation concepts
- Graphic design specifications

**Keywords that trigger this skill:**
image, design, visual, graphic, logo, illustration, picture, art, ui, layout, midjourney, dall-e, stable diffusion, prompt for image, draw, sketch, render, generate image

---

## OPTIMIZATION CHECKLIST

✓ **Medium Specified?**
  - Image generation AI (which one?), UI wireframe, photography, illustration?

✓ **Style Defined?**
  - Art style, photography style, design style?
  - Reference artists or works?

✓ **Subject and Composition?**
  - What is the main subject?
  - Foreground, background, perspective?
  - Lighting and color palette?

✓ **Technical Parameters?**
  - Aspect ratio, resolution?
  - Negative prompts (what to avoid)?
  - Quality/detail modifiers?

---

## OPTIMIZATION TEMPLATE

### For Image Generation Prompts:
```
[Subject], [action/pose], [setting/environment], [lighting], [color palette],
[art style or medium], [artist reference if applicable], [quality modifiers],
[camera/perspective details], [mood/atmosphere]

Negative prompt: [what to avoid]

Parameters: --ar [ratio] --v [version] (for Midjourney)
```

### For UI/Design Briefs:
```
You are a senior UX/UI designer with expertise in [web/mobile/product design].

DESIGN BRIEF:
Product: [what is it]
Users: [who will use it]
Goal: [what it should accomplish]

REQUIREMENTS:
- Style: [minimal / material / glassmorphism / etc.]
- Color palette: [specific colors or mood]
- Components needed: [list]
- Accessibility: [WCAG level]
- Platform: [web / iOS / Android / desktop]

SUCCESS CRITERIA:
- [Usability target]
- [Visual goal]
```

---

## COMMON IMPROVEMENTS

### ❌ BAD Image Prompt:
```
"A cat sitting on a chair"
```

### ✅ GOOD Image Prompt:
```
A fluffy orange tabby cat sitting regally on a vintage velvet armchair,
soft window light from the left casting gentle shadows,
warm golden afternoon tones, cozy home interior background slightly blurred,
photorealistic, 85mm portrait lens, shallow depth of field,
highly detailed fur texture, professional pet photography style

Negative prompt: cartoon, anime, blurry, low quality, extra limbs

--ar 4:5 --v 6 --q 2
```

### ❌ BAD UI Brief:
```
"Design a login page"
```

### ✅ GOOD UI Brief:
```
You are a senior UI designer specializing in SaaS applications.

Design a login page for a B2B analytics platform.

REQUIREMENTS:
- Style: Clean, minimal, professional (not playful)
- Color: Dark navy (#1a1f36) background, white text, electric blue (#4f6ef7) CTA
- Components: Email field, password field, "Remember me" checkbox,
  sign-in button, "Forgot password" link, social SSO (Google, GitHub)
- Layout: Centered card on full-screen background with subtle geometric pattern
- Accessibility: WCAG 2.1 AA compliant, keyboard navigable
- Platform: Web (desktop first, responsive)

SUCCESS CRITERIA:
- User completes login in under 30 seconds
- Passes color contrast requirements (4.5:1)
- Feels trustworthy and enterprise-grade
```

---

## DOMAIN-SPECIFIC TIPS

### For Midjourney:
- Most important descriptors first
- Use `::` for weighting important elements
- Always include style/medium
- Lighting spec hugely impacts output

### For DALL-E:
- More conversational, sentence-based
- Be explicit about style (photorealistic, watercolor, vector art, etc.)
- Describe spatial relationships clearly

### For UI Design:
- Define the user's emotional state when they arrive
- Specify hover/active states if important
- Include spacing preferences (dense/airy)

---

## ANTI-PATTERNS TO AVOID

❌ Don't leave style undefined — outputs become generic
❌ Don't forget lighting specifications for photo-realistic prompts
❌ Don't omit negative prompts for image generation
❌ Don't describe UI without specifying the user's task
