export function countWords(text: string): number {
  return text.replace(/\s/g, "").length;
}

export function countChineseWords(text: string): number {
  return (text.match(/[\u4e00-\u9fa5]/g) || []).length;
}

export function countEnglishWords(text: string): number {
  return (text.match(/[a-zA-Z]+/g) || []).length;
}

export function countMixedWords(text: string): number {
  const chinese = countChineseWords(text);
  const english = countEnglishWords(text);
  return chinese + english;
}

