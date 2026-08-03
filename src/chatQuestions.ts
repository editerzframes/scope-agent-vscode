import { isRecord } from "./protocol";

export interface UiQuestionOption {
  label: string;
  description: string | null;
}

export interface UiQuestion {
  id: string;
  header: string;
  question: string;
  options: UiQuestionOption[];
  allowsOther: boolean;
  isSecret: boolean;
}

export function parseUiQuestions(params: unknown): UiQuestion[] {
  if (!isRecord(params) || !Array.isArray(params.questions)) {
    return [];
  }
  const seen = new Set<string>();
  const questions: UiQuestion[] = [];
  for (const value of params.questions.slice(0, 12)) {
    if (!isRecord(value) || typeof value.id !== "string") {
      continue;
    }
    const id = value.id.trim().slice(0, 160);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const options = Array.isArray(value.options)
      ? value.options
        .filter(isRecord)
        .flatMap((option) => {
          if (typeof option.label !== "string" || !option.label.trim()) {
            return [];
          }
          return [{
            label: option.label.trim().slice(0, 180),
            description: typeof option.description === "string"
              ? option.description.trim().slice(0, 400) || null
              : null,
          }];
        })
        .slice(0, 12)
      : [];
    questions.push({
      id,
      header: typeof value.header === "string"
        ? value.header.trim().slice(0, 100) || "Puneet 3.0 needs input"
        : "Puneet 3.0 needs input",
      question: typeof value.question === "string"
        ? value.question.trim().slice(0, 1200) || "Choose how to continue."
        : "Choose how to continue.",
      options,
      allowsOther: value.isOther === true || options.length === 0,
      isSecret: value.isSecret === true,
    });
  }
  return questions;
}

export function normalizeUiQuestionAnswer(
  question: UiQuestion,
  value: unknown,
  custom: boolean,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const answer = value.trim().slice(0, 4000);
  if (!answer) {
    return "";
  }
  if (custom) {
    return question.allowsOther ? answer : null;
  }
  if (question.options.length === 0) {
    return answer;
  }
  return question.options.some((option) => option.label === answer) ? answer : null;
}
