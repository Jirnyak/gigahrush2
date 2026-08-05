/* ── Pneumomail capsules: old infrastructure, fallible leads ─── */

export const PNEUMOMAIL_ROOM_NAME = 'Пневмопочтовый узел: прием и перехват';
export const PNEUMOMAIL_SORTER_ROOM_NAME = 'Пневмопочтовый узел: сортировка чужих капсул';
export const PNEUMOMAIL_ROOM_PREFIX = 'Пневмопочтовый узел';
export const PNEUMOMAIL_CAPSULE_ITEM_ID = 'pneumomail_capsule';
export const PNEUMOMAIL_CONTRACT_ID = 'maint_pneumomail_pressure_manifest';
export const PNEUMOMAIL_HISTORY_CAPACITY = 12;

export type PneumomailCapsuleKind =
  | 'true_lead'
  | 'false_lead'
  | 'contract'
  | 'empty'
  | 'contraband'
  | 'warning';

export const PNEUMOMAIL_REQUIRED_KINDS: readonly PneumomailCapsuleKind[] = [
  'true_lead',
  'warning',
  'contraband',
  'contract',
  'false_lead',
];

export interface PneumomailCapsuleItem {
  defId: string;
  count: number;
}

export interface PneumomailCapsuleDef {
  id: string;
  kind: PneumomailCapsuleKind;
  weight: number;
  text: string;
  rumorId?: string;
  contractId?: string;
  items?: readonly PneumomailCapsuleItem[];
  severity: 1 | 2 | 3 | 4;
}

export const PNEUMOMAIL_CAPSULES: readonly PneumomailCapsuleDef[] = [
  {
    id: 'true_heatline_valve',
    kind: 'true_lead',
    weight: 4,
    text: 'Капсула от слесаря стучит три раза: «На развилке стояков 16 сорвало бирку вентиля у красного ввода. Забери бирку, но сначала проверь мокрый пол: там ток от щитка и свидетелей не будет.»',
    rumorId: 'pneumomail_true_heatline_valve',
    severity: 3,
  },
  {
    id: 'betonov_z22_route',
    kind: 'true_lead',
    weight: 2,
    text: 'Капсула НИИ адресована Бетонову: «На Z+22 идти с водой, фильтром и пустой тарой. После лифта держись правой Z-метки, пробу не вскрывай; Яков платит только за целую пломбу и маршрут.»',
    rumorId: 'betonov_wrong_lift_route',
    severity: 4,
  },
  {
    id: 'false_archive_chute',
    kind: 'false_lead',
    weight: 3,
    text: 'Капсула N-0 обещает открытый архив труб, но бумага слишком свежая: нет печати смены, номера поста и следа от сортировочного ролика. Верить ей - значит прийти к пустой трубе и лишнему досмотру.',
    severity: 2,
  },
  {
    id: 'betonov_false_lift',
    kind: 'false_lead',
    weight: 2,
    text: 'Капсула с мокрой картой уверяет, что лифт Z+22 теперь выше кухни. Чернила свежие, диспетчер маршрут не принимал; идти по ней можно только как по приманке для проверки чужого поста.',
    severity: 2,
  },
  {
    id: 'pressure_manifest_contract',
    kind: 'contract',
    weight: 2,
    text: 'Из капсулы выпал талон контроля пневмопочты: сверить журнал давления в сортировке и вернуть лист с номером смены. Оплата после сдачи - предохранители и водные талоны; потеря журнала закроет узел.',
    rumorId: 'pneumomail_contract_pressure_manifest',
    contractId: PNEUMOMAIL_CONTRACT_ID,
    severity: 4,
  },
  {
    id: 'empty_return',
    kind: 'empty',
    weight: 2,
    text: 'Тубус пришел пустым: внутри пыль, запах старого фильтра и след сорванного сургуча. Значит, посылку вынули раньше; капсулу можно сдать как улику или не трогать, чтобы не принять чужой долг.',
    severity: 1,
  },
  {
    id: 'betonov_empty_tar',
    kind: 'empty',
    weight: 1,
    text: 'Тубус пришел с пустой тарой НИИ и запиской на крышке: «образец ушел рынком, подпись вернулась лифтом». Яков примет тару как след утечки, рынок спросит, где сама банка.',
    severity: 2,
  },
  {
    id: 'contraband_note',
    kind: 'contraband',
    weight: 2,
    text: 'Внутри фальшивый корешок и маршрут без подписи смены. Сдать ликвидаторам - улика против сортировки; продать рынку - быстрые деньги и риск, что пост узнает ваш почерк.',
    rumorId: 'pneumomail_contraband_note',
    items: [
      { defId: PNEUMOMAIL_CAPSULE_ITEM_ID, count: 1 },
      { defId: 'forged_permit_slip', count: 1 },
    ],
    severity: 4,
  },
  {
    id: 'samosbor_warning',
    kind: 'warning',
    weight: 3,
    text: 'Капсула теплая и пахнет резиной: «Если труба замолчала перед сиреной, не жди следующую почту. Закрывай приемный люк, бери журнал давления и иди к ближайшей герме.»',
    rumorId: 'pneumomail_warning_samosbor',
    severity: 3,
  },
  {
    id: 'betonov_sample_warning',
    kind: 'warning',
    weight: 2,
    text: 'Капсула пахнет йодом и несет инструкцию НИИ: черную пробу нести на прожиг, белую держать в темном ящике, прозрачную сдавать только с целой пломбой. Рынок платит быстрее, но потом ищут курьера.',
    rumorId: 'betonov_sample_handoff',
    severity: 4,
  },
];
