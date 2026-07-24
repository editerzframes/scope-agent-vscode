import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeUiQuestionAnswer,
  parseUiQuestions,
} from "../src/chatQuestions";

test("parses Codex questions and their options for in-chat rendering", () => {
  const questions = parseUiQuestions({
    questions: [
      {
        id: "approach",
        header: "Choose approach",
        question: "How should this be implemented?",
        options: [
          { label: "Focused fix", description: "Change only the affected path." },
          { label: "Refactor", description: "Improve the surrounding design too." },
        ],
        isOther: true,
      },
      {
        id: "secret",
        question: "Enter the temporary value",
        isSecret: true,
      },
    ],
  });

  assert.equal(questions.length, 2);
  assert.equal(questions[0].header, "Choose approach");
  assert.equal(questions[0].options[0].label, "Focused fix");
  assert.equal(questions[0].allowsOther, true);
  assert.equal(questions[1].options.length, 0);
  assert.equal(questions[1].allowsOther, true);
  assert.equal(questions[1].isSecret, true);
});

test("accepts listed, custom, free-form, and skipped in-chat answers safely", () => {
  const [choice] = parseUiQuestions({
    questions: [{
      id: "approach",
      question: "Choose",
      options: [{ label: "Focused fix" }],
      isOther: true,
    }],
  });
  assert.equal(normalizeUiQuestionAnswer(choice, "Focused fix", false), "Focused fix");
  assert.equal(normalizeUiQuestionAnswer(choice, "Something else", true), "Something else");
  assert.equal(normalizeUiQuestionAnswer(choice, "Unknown option", false), null);
  assert.equal(normalizeUiQuestionAnswer(choice, "", true), "");

  const [freeForm] = parseUiQuestions({
    questions: [{ id: "details", question: "Add details" }],
  });
  assert.equal(normalizeUiQuestionAnswer(freeForm, "A concise answer", false), "A concise answer");
});
