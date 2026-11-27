# AP Exam Room JSON Import Format

In **Question Bank → Import JSON**, select a UTF-8 `.json` file (up to 4 MB). Review the number of tests, questions, and answer keys before importing. Use a new `id` for each test. An import with a duplicate ID is rejected.

## Example

```json
{
  "schemaVersion": 1,
  "id": "stats-unit-1-review",
  "title": "AP Statistics Unit 1 Review",
  "subject": "AP Statistics",
  "subjectKey": "stats",
  "category": "homework",
  "durationSeconds": 900,
  "frqDurationSeconds": 600,
  "questions": [
    {
      "origId": 1,
      "stem": "Which measure is most resistant to outliers?",
      "options": ["Mean", "Median", "Range", "Standard deviation"],
      "correctAnswer": "B",
      "explanation": "The median depends on order rather than the size of extreme values."
    }
  ],
  "frqQuestions": [
    {
      "stem": "Explain how an unusually large observation can change the mean.",
      "rubricHtml": "<p>The sum increases while the sample size stays the same.</p>"
    }
  ]
}
```

| Field | Format |
| --- | --- |
| `id` | Stable, unique string. If omitted, the title is used to generate the ID. |
| `title` | Required, nonempty test name. |
| `subject`, `subjectKey` | Display name and optional grouping key. Existing keys are `stats`, `csa`, and `micro`. |
| `category` | `mock`, `homework`, or `quiz`. Defaults to `homework`. |
| `durationSeconds`, `frqDurationSeconds` | Section I and II limits in seconds, from 1 to 21,600. The legacy `timeLimit` field sets Section I in minutes. |
| `questions` | Required nonempty array. Each question needs a prompt. Use `stem`, `stemHtml`, or `question`, and optionally `promptHtml`. |
| `origId` | Unique positive integer within Section I. Defaults to the question's position. Legacy `number` also works. |
| `options` | Array of strings or objects such as `{"letter":"A","html":"<p>Mean</p>"}`. Letters are assigned in array order when omitted. Legacy `sign` and `content` also work. |
| `correctAnswer` | Option letter. Leave empty for questions without an answer key. The test-level `answers` object keyed by question number is also supported. |
| `topic` | Optional topic label displayed on the result page. |
| `rationaleHtml` | Optional detailed written solution, displayed before any video walkthrough. |
| `explanation` | Optional text or HTML. Legacy `analysis` and test-level `explanations` are also supported. |
| `frqQuestions` | Optional free-response array. Include a prompt and optional `rubricHtml`. Free responses are stored for review and are manually scored. |

You can also import an array of tests or an object with an `exams` array. Basic HTML, MathML, tables, and embedded PNG, JPEG, WebP, or GIF images are supported. Scripts, external images, and unsupported markup are removed. **Export Missed Questions** produces a JSON test you can import again for targeted practice.
