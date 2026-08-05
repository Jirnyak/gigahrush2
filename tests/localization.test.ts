import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocalizationLanguage, translateText } from '../src/systems/localization';

function sourceKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function exact(source: string, translation: string): [string, string] {
  return [sourceKey(source), translation];
}

globalThis.__GIGAHRUSH_EN_LOCALE__ = [
  [
    exact('Продолжить', 'Continue'),
    exact('Иван', 'Ivan'),
    exact('Петрова', 'Petrova'),
    exact('Чёрный', 'Black'),
    exact('Идол', 'Idol'),
    exact('Глаз', 'Eye'),
    exact('Калашников', 'Kalashnikov'),
    exact('Совет', 'Tip'),
    exact('зона', 'zone'),
    exact('руб.', 'rub.'),
    exact('выбрать', 'select'),
    exact('Пробел', 'Space'),
    exact('ПКМ', 'RMB'),
    exact('закрыть', 'close'),
    exact('AI факт', 'AI facts'),
    exact('Этаж 69: работница', 'Floor 69: worker'),
    exact('на северо-востоке', 'to the north-east'),
    exact('сид мира', 'world seed'),
    exact('после глаза полезнее сразу закрыть угол, чем смотреть на труп', 'after the eye, closing the corner at once is more useful than staring at the corpse'),
    exact('держит дистанцию и стреляет по прямой', 'keeps distance and shoots in a straight line'),
    exact('ломайте линию огня дверью, углом или стеной и отвечайте после выстрела', 'break line of fire with a door, corner, or wall, and answer after the shot'),
    exact('Сборка', 'Assembly'),
    exact('7.62 редкие, пустой автомат не пугает никого', '7.62 is rare; an empty automatic rifle scares nobody'),
    exact('слышен треск проволоки и мелкий топот', 'heard as wire cracking and tiny steps'),
    exact('примите её в широком месте, сбейте первым дешёвым выстрелом и отходите за угол', 'meet it in a wide spot, stop it with the first cheap shot, and back around a corner'),
  ],
  [
    ['Снято ${moved} руб.', 'Withdrew ${moved} rub.'],
    ['${value} руб.', '${value} rub.'],
    ['С${event.zoneId + 1}', 'S${event.zoneId + 1}'],
    ['Сумма: ${money}', 'Amount: ${money}'],
    ['Совет ${i + 1}: ${TIPS[i]}', 'Tip ${i + 1}: ${TIPS[i]}'],
    ['${name} вписан в ведомость.', '${name} was entered in the roster.'],
    ['Этаж ${label}', 'Floor ${label}'],
    ['Найди его {dir}.', 'Find him {dir}.'],
    ['СИД МИРА: ${currentRunSeedLabel(state)}', 'WORLD SEED: ${currentRunSeedLabel(state)}'],
    [
      "Самосбор начался${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ''}. Ищите гермодверь.",
      "Samosbor started${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ''}. Find a hermodoor.",
    ],
  ],
];

test('localization translates exact, decorated and templated Russian UI text', () => {
  setLocalizationLanguage('en');
  assert.equal(translateText('Продолжить'), 'Continue');
  assert.equal(translateText('▶ Продолжить'), '▶ Continue');
  assert.equal(translateText('Снято 45 руб.'), 'Withdrew 45 rub.');
});

test('localization translates composed procedural names and template values', () => {
  setLocalizationLanguage('en');
  assert.equal(translateText('Иван Петрова'), 'Ivan Petrova');
  assert.equal(translateText('Чёрный Идол'), 'Black Idol');
  assert.equal(translateText('Сумма: 45 руб.'), 'Amount: 45 rub.');
  assert.equal(translateText('Иван Петрова вписан в ведомость.'), 'Ivan Petrova was entered in the roster.');
});

test('localization prefers specific decorated procedural names over broad templates', () => {
  setLocalizationLanguage('en');
  assert.equal(translateText('Этаж 69: работница 12'), 'Floor 69: worker 12');
});

test('localization handles authored brace placeholders with generated directions', () => {
  setLocalizationLanguage('en');
  assert.equal(translateText('Найди его на северо-востоке.'), 'Find him to the north-east.');
});

test('localization translates world seed labels', () => {
  setLocalizationLanguage('en');
  assert.equal(translateText('сид мира'), 'world seed');
  assert.equal(translateText('СИД МИРА: 424242'), 'WORLD SEED: 424242');
});

test('localization handles nested generated template placeholders', () => {
  setLocalizationLanguage('en');
  assert.equal(
    translateText('Самосбор начался: зона 2. Ищите гермодверь.'),
    'Samosbor started: zone 2. Find a hermodoor.',
  );
});

test('localization translates generated loading tips assembled from fragments', () => {
  setLocalizationLanguage('en');
  const translated = translateText('Совет 153: Глаз: после глаза полезнее сразу закрыть угол, чем смотреть на труп.');
  assert.equal(translated, 'Tip 153: Eye: after the eye, closing the corner at once is more useful than staring at the corpse.');
  assert.doesNotMatch(translated, /[А-Яа-яЁё]/);
});

test('localization translates capitalized generated fragments', () => {
  setLocalizationLanguage('en');
  assert.equal(
    translateText('Глаз: держит дистанцию и стреляет по прямой. Ломайте линию огня дверью, углом или стеной и отвечайте после выстрела.'),
    'Eye: keeps distance and shoots in a straight line. Break line of fire with a door, corner, or wall, and answer after the shot.',
  );
});

test('localization translates generated multi-sentence tip fragments', () => {
  setLocalizationLanguage('en');
  const translated = translateText('Сборка: слышен треск проволоки и мелкий топот. Примите её в широком месте, сбейте первым дешёвым выстрелом и отходите за угол.');
  assert.equal(
    translated,
    'Assembly: heard as wire cracking and tiny steps. Meet it in a wide spot, stop it with the first cheap shot, and back around a corner.',
  );
  assert.doesNotMatch(translated, /[А-Яа-яЁё]/);
});

test('localization does not apply short Cyrillic templates inside longer words', () => {
  setLocalizationLanguage('en');
  assert.equal(translateText('С12'), 'S12');
  assert.equal(translateText('Сборка'), 'Assembly');
  assert.equal(
    translateText('Сборка: слышен треск проволоки и мелкий топот.'),
    'Assembly: heard as wire cracking and tiny steps.',
  );
});

test('localization keeps decimal numbers intact while translating delimited tips', () => {
  setLocalizationLanguage('en');
  const translated = translateText('Совет 440: Калашников: 7.62 редкие, пустой автомат не пугает никого.');
  assert.equal(translated, 'Tip 440: Kalashnikov: 7.62 is rare; an empty automatic rifle scares nobody.');
  assert.doesNotMatch(translated, /[А-Яа-яЁё]/);
});

test('localization translates English debug overlay fragments', () => {
  setLocalizationLanguage('en');
  const translated = translateText('15/130  Enter выбрать  ~/[ПКМ] закрыть');
  assert.equal(translated, '15/130  Enter select  ~/[RMB] close');
  assert.doesNotMatch(translated, /[А-Яа-яЁё]/);
  assert.equal(translateText('AI факт: plot 92 boss 0 atk 83 proj 2/2'), 'AI facts: plot 92 boss 0 atk 83 proj 2/2');
});

test('localization keeps uncovered Cyrillic instead of fabricating English fallback text', () => {
  setLocalizationLanguage('en');
  const translated = translateText('Неизвестная фраза');
  assert.equal(translated, 'Неизвестная фраза');
});

test('localization keeps Russian text when Russian is active', () => {
  setLocalizationLanguage('ru');
  assert.equal(translateText('Продолжить'), 'Продолжить');
  assert.equal(translateText('Неизвестная фраза'), 'Неизвестная фраза');
});
