# Review Guidelines Index

This index helps determine which review guidelines to load based on the changes under review.

## Execution Instructions

### Review Process
**File:** @knowledge/review-guidelines/02-review-process.md
**Purpose:** Step-by-step execution instructions for reviewing a change in this repo
**When to use:** Primary process file - always load first when performing a code review

## Available Guidelines

### Code conventions and project invariants
**File:** @knowledge/review-guidelines/03-code-conventions.md
**Keywords:** convention, typescript, any, comments, lint, ingress, tv, pairing, geometry, release, version, secret
**When to use:** every review; contains the checks specific to this add-on

## Loading Logic

1. **Primary:** Always load 02 and 03
2. **Secondary:** Load the matching implementation guideline from @knowledge/implementation-guidelines/01-index.md for the packages the diff touches

## Usage

Run the process in 02, apply the checks in 03, and report findings ordered by severity.
