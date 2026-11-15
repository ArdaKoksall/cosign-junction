# Nemotron intake evaluation

Set a valid `NVIDIA_API_KEY` in the private root `.env` and start the [legacy connected Valio workspace](../../docs/architecture/developer-setup.md#legacy-workspaces). From the repository root, point the evaluator at that workspace, for example `COSIGN_URL=http://localhost:5173 node validation/model-eval/evaluate.mjs` when using the Vite frontend.

Six synthetic text cases in Finnish and English exercise explicit fields, a case count, conflicting quantities, a missing delivery time, and a reliability preference alongside a firm budget. One case uses an unpunctuated, spoken-style transcript with `kgs`, a month-first ordinal date, `euros`, and a trailing carbon preference.

The [synthetic Finnish kitchen photo](kitchen-note.png) tests the milk, case count, deadline, lactose-free requirement and ex-VAT budget with excerpts from the corresponding image lines. Two cases pair it with a typed order. A typed count of 100 cases must pause the draft and cite both sources. A typed count of 10 cases must yield an editable draft. The [pantry requisition](pantry-requisition.png) tests vegan and gluten-free requirements and a carbon preference with excerpts for each. Both images use 24 November 2080 at 11:00 Helsinki time so the test cases stay usable after the event.

Set `COSIGN_CHALLENGE_PHOTO` to a local copy of the Valio Aimo challenge poster to run the optional reference-document case. Use a PNG or JPEG under 2 MiB. The expected result is a clarification with empty purchase fields and no field evidence, even though the poster includes a sample order.

The runner reports individual failures, per-case timings, extraction sources, and median and maximum latency across completed HTTP responses. A correct typed draft may come from Nemotron or the local parser. Photo cases require Nemotron. The runner exits nonzero if any case fails. Mocked adapter coverage lives in the [server test](../../server/test/nemotron.test.ts).

## Browser walkthrough

In the legacy connected workspace, choose **New request**. Upload the [Finnish kitchen photo](kitchen-note.png), type `The kitchen needs 100 cases of lactose-free milk.`, and select **Fill request fields**. The note and photo should appear together for quantity review. To continue to supplier comparison, use a requisition with a future date supported by Valio, enter the buyer-confirmed quantity in litres, and select **Find & compare offers**. [Live supplier checks](../README.md#connected-valio-observations)
