# Diagnostics Recent Jobs Layout Design

## Context

The macOS app has a Diagnostics / Attention window implemented in `macos/AgentVoiceApp/Sources/AgentVoiceApp/AttentionDetailView.swift`. Its current `queueActivitySection` combines queue counts and the full recent jobs list near the top of the window. Long job cards can grow vertically because each card renders metadata, summary, last error, and full raw job text inline.

## Goal

Move the full recent jobs list to the bottom of the Diagnostics window. Each recent-job card should have a balanced default size and scroll independently when its contents exceed that size.

## Chosen Approach

Use a fixed-height recent-job card with one internal vertical scroll region for the card contents.

This keeps each job visually bounded, prevents one long raw text payload from stretching the entire diagnostics page, and avoids adding expand/collapse state or several tiny nested scroll regions inside each card.

## Layout

The Diagnostics window keeps one primary page scroll for the whole window. The top sections remain focused on health, runtime, queue counts, configuration, doctor checks, and the raw diagnostic snapshot. Recent jobs move to the bottom of the page.

To preserve queue visibility, split the existing queue/activity section into:

1. A queue summary section near the top, containing only the existing five queue counters: pending, processing, done, failed, and skipped.
2. A recent jobs section at the bottom, containing the history refresh controls, explanatory copy, recent job cards, and pagination controls.

## Job Card Behavior

Each recent-job card uses a balanced default height of 300 points. The card frame remains stable. Its content is wrapped in an internal vertical `ScrollView`, so long metadata values, summaries, errors, or raw job text can be inspected without changing the card height or pushing other sections around.

The existing card content remains available:

- Agent and status badge
- Job ID
- Created / finished timestamps
- Attempts
- Working directory
- Summarizer used
- Skip reason
- Summary
- Last error
- Full raw job text

## Testing

Update source-level Swift tests to assert:

- Recent jobs are represented by a separate bottom section.
- The Diagnostics body renders the recent jobs section after the raw snapshot section.
- `jobCard` uses a fixed balanced card height of 300 points.
- `jobCard` contains an internal `ScrollView`.
- Existing one-primary-scroll-region tests are updated to allow the page-level `ScrollView` plus the intentional per-job-card scroll region.

Run the Swift package tests for `AgentVoiceApp` and project type checks where practical.
