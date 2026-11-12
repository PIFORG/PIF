# PIF MarketLab — design system

**Stack:** Angular (`apps/web`) · Spring Boot (`apps/api`) · PostgreSQL  
**Identity:** institutional navy / royal blue workstation + educational clarity.

## Palette

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#F7F9FD` | `#0B1733` |
| Surface | `#FFFFFF` | `#101F42` |
| Elevated / soft azure | `#EAF2FF` | `#162752` |
| Text | `#0B1733` | `#F4F8FF` |
| Muted text | `#64748B` | `#A8B8D4` |
| Royal brand | `#245BEB` | `#3478F6` |
| Brand strong | `#1A4AD0` | `#245BEB` |
| Positive / negative / caution | green / red / amber semantics only |

Tokens: `apps/web/src/styles/globals.css` (`--mtr-*`). Profit is never conveyed by blue alone.

## Typography

Geist Variable (sans) + Geist Mono for figures.

## Theme

Light is the default (`:root`). Dark via `html[data-theme=dark]`.
