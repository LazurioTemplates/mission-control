---
name: publish-plan-changes
description: "Publish the Mission Control draft (new and edited plans and roadmaps) into the Organization's data, only after the person said \"Publikuj\" for exactly these changes. Use when a person asks you to publish the plan changes; never on your own after a change."
---

# Publish the plan changes

Every edit in Mission Control is first a draft. Publishing the draft puts all
its changes into the Organization's data as one change that colleagues and
agents see. It is a Publication: you do it only on the person's explicit
instruction ("Publikuj", "publish it") for the changes they saw, never because
a check passed or a task seems done. Without that instruction you prepare
everything and stop.

## 1. Find the App and whether it lets you publish

Use the App's tools for agents as in the skill `create-plan`.

- `publish_draft` is a tool of its own, offered only where the App lets an
  agent publish: a Module version in an Environment that writes. A production
  application does not offer it to agents (module-kit 0.5.0): there the person
  publishes on the Draft page ("Koncept a publikace" / "Draft and publish").
  Say so and stop.
- `get_app_context` with `can_write: false` means this copy changes nothing,
  publication included.
- Never publish by editing the files of `db/` or running Git on them: the
  App's publication is the only one, with its check and its record of who
  published.

## 2. Show what would be published

- Run the skill `check-plans`. A draft with findings is not published: show
  the findings and fix them with the person first.
- `get_draft` (`GET /api/draft?locale=<cs|en>`) returns the changed records
  and the draft's `revision`. Show the person every changed record (code,
  title, kind of change, the changed fields) in their language, and keep the
  `revision`.
- When the draft holds changes the person did not ask for (a colleague's, an
  earlier session's), name them. The draft is published whole; returning a
  part is `discard_draft` with `{"kind": "record", "path": "<technicalPath>"}`,
  only on the person's instruction, because discarded changes are gone.

## 3. Publish on the person's word

After the person's "Publikuj" for the changes you showed:

- `publish_draft` with `{"expectedRevision": "<revision from get_draft>"}` and,
  if the person gave one, a `summary` of the change. Over the HTTP API on the
  loopback address:

```bash
curl -sS -X POST "http://127.0.0.1:<port>/api/draft/publish" \
  -H "content-type: application/json" -H "origin: http://127.0.0.1:<port>" \
  -H "x-lazurio-channel: cli" \
  -d '{"expectedRevision":"<revision>","summary":"Shared glossary review"}'
```

- `draft_changed` means the draft changed after you showed it: read
  `get_draft` again, show the difference and ask again. Never publish a
  revision the person did not see.
- `publish_conflict`, `publish_push_failed` or `send_pending`: the
  publication did not finish. Do not retry blindly; tell the person and leave
  finishing the send or taking colleagues' work to the Draft page's buttons.
  They are not tools.

## 4. Hand over

Say what was published (codes and titles), when (`date -u`), and that
colleagues and agents now work from it. A failed publication says exactly
what stayed in the draft.
