export const GENRES = [
  'драма',
  'комедия',
  'боевик',
  'триллер',
  'ужасы',
  'фантастика',
  'фэнтези',
  'мелодрама',
  'анимация',
  'документальное',
  'детектив',
  'приключения',
  'артхаус',
  'мюзикл',
  'семейное',
] as const;

export const GENDERS = ['female', 'male', 'other', 'unspecified'] as const;
export const LANGUAGE_PREFS = ['dub', 'ov', 'any'] as const;
export const MEET_FORMATS = ['pair', 'group', 'any'] as const;
export const INVITATION_FORMATS = ['pair', 'group'] as const;
export const TICKET_MODES = ['self', 'host', 'discuss'] as const;
export const SHOW_LANGUAGES = ['DE', 'OV', 'OmU'] as const;

export const REPORT_REASONS = {
  spam: 'Спам или реклама',
  abuse: 'Оскорбления',
  fake: 'Фейковый профиль',
  minor: 'Похоже, пользователю нет 18',
  meeting: 'Неуместное поведение на встрече',
  other: 'Другое',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
