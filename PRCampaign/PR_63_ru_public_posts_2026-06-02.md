# PR 63 - RU Public Posts / VK Telegram DTF Follow-up

Date: 2026-06-02.

Window: 20:35-21:02 BST.

Owner instruction: continue on Russian sites, VK, Telegram, GameDev and DTF; user specifically wanted real posts, including a new DTF post if possible.

Follow-up owner correction: after the first GameDev.ru reply, owner clarified that DTF and GameDev should be new posts, not updates to old threads. A new GameDev.ru release topic was then created.

No votes, likes, reactions, fake comments, repost asks, captcha bypass, paid placement or moderation evasion were made.

## Published

| Surface | Status | Evidence | Notes |
| --- | --- | --- | --- |
| GameDev.ru new release topic | Posted live new topic | `https://gamedev.ru/projects/forum/?id=295635` | Created as `TENEVIK` in rubric `Релизы`, title `ГИГАХРУЩ 02.06: EN-версия и фикс FPS-drop на монстрах`, message `#0`, visible timestamp `23:01, 2 июня 2026`. Public shell returned `HTTP/2 200`; HTML contains `#0`, MyIndie, direct build, itch and Telegram links. |
| GameDev.ru existing Tenevik thread | Posted live reply before owner correction | `https://gamedev.ru/projects/forum/?id=295560&m=6192509#m1` | Posted as `TENEVIK`, message `#1`, visible timestamp `22:47, 2 июня 2026`. This is not the final requested GameDev result after owner clarified that new posts were required. |

### GameDev.ru New Topic Copy Published

```text
ГИГАХРУЩ 02.06: EN-версия и фикс FPS-drop на монстрах

Привет. Это отдельный короткий релизный апдейт от Tenevik Games по ГИГАХРУЩ / GIGAH|RUSH.

Сегодня выложил новую публичную сборку: английская версия теперь доступна на itch.io и в прямом браузерном билде, а тяжелую просадку FPS при появлении пачки монстров / экранного эффекта поправил. Этот FPS-drop уже заметили при внешней проверке, поэтому хочется быстро собрать обратную связь именно по исправленной версии.

ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter про вылазки в безграничную бетонную структуру. Игрок готовит воду, еду, патроны, медицину, документы и оружие, выходит из жилой зоны, торгуется, ищет слухи и контракты, переживает САМОСБОР и пытается вернуться с добычей и последствиями.

Что проверить в этой сборке:

1. Не проседает ли FPS на первых плотных столкновениях с монстрами.
2. Стало ли проще играть тем, кому нужен английский интерфейс/страница.
3. Понятно ли в первые 5-10 минут, куда идти и зачем готовить припасы.
4. Что хуже всего читается: HUD, карта, инвентарь, журнал, торговля.
5. Где хочется закрыть вкладку.

RU/MyIndie:
https://myindie.ru/games/game/gigahrush

Direct browser build:
https://gigahrush.bileter.workers.dev

itch.io / EN mirror:
https://tenevik.itch.io/gigahrush

Telegram / обновления:
https://t.me/gigah_rush

Если ловите просадку FPS или темный экран, напишите браузер, устройство, что было на экране и сколько ждали. Не прошу апов или оценок: нужны конкретные места, которые можно чинить.

Контент-нота: survival horror, оружие, кровь, трупы, монстры, сирены, тревожные события и элементы body-horror. Не NSFW/adult.
```

### GameDev.ru Existing Thread Reply Copy

```text
Апдейт 02.06.

Залил новую публичную сборку: английская версия теперь доступна на itch.io и в прямом Cloudflare-билде, а тяжелую просадку FPS при появлении пачки монстров / экранного эффекта я поправил. Это было ровно то место, на которое уже указали при внешней проверке.

Если кто-то откладывал запуск из-за английского текста или лагов на первых столкновениях, лучше проверять текущие ссылки:

RU/MyIndie:
https://myindie.ru/games/game/gigahrush

Direct browser build:
https://gigahrush.bileter.workers.dev

itch.io / EN mirror:
https://tenevik.itch.io/gigahrush

Telegram / обновления:
https://t.me/gigah_rush

Сейчас полезнее всего конкретный фидбек по первым 5-10 минутам: загрузка, первая цель, читаемость HUD/карты/инвентаря и момент, где хочется закрыть вкладку. Если снова ловите просадку FPS: браузер, устройство, что было на экране и примерно сколько монстров/эффектов.
```

## Blocked / Not Posted

| Surface | Result | Exact blocker | Safe next action |
| --- | --- | --- | --- |
| DTF new post | Not posted | DTF session showed an authenticated shell (`Artem Jirnyak`, `@id3477068`) and editor link, but clicking editor redirected to Yandex OAuth with `Сервис ещё не верифицирован` and `Войти как jirnyak@gmail.com`. No OAuth consent was granted by automation. | Owner should complete/approve DTF OAuth in browser and ideally confirm the intended posting identity. Then publish the fresh EN/fix update as a real new post only if the editor previews it under `Инди`, not as a duplicate link bump. |
| VK owned/profile post | Not posted | Chrome `https://vk.com/feed` redirected to VK welcome/login QR. Opera GX had a `News feed` VK tab title but JS probing was unavailable and the visible window could not be controlled safely. | Owner should open VK logged in and visible on the current desktop, then use the VK copy below as one owned-profile update or one group предложка where rules allow it. |
| Telegram main channel | Not posted | Chrome Telegram Web showed QR login only. Native Telegram was logged in and `tg://resolve?domain=gigah_rush` opened official channel `ГИГАХРУЩ` with `Broadcast a message...`, but macOS blocked controlled clicks with System Events error `-25200`, no `cliclick` is installed, and paste did not focus the composer. | Owner can paste the Telegram copy below manually into `@gigah_rush`. If automation is needed later, grant Accessibility permission or install/use an approved click tool. |
| forum.indie.ru devlog | Not posted | Chrome opened the existing devlog thread but the page was logged out and showed `Войдите или зарегистрируйтесь для ответа.` | Owner should log in as `TENEVIK`; future updates belong in the existing thread, not a duplicate topic. |

## Ready Copy - DTF New Post

Use only after the owner completes OAuth and the editor preview shows the post under `Инди`.

```text
ГИГАХРУЩ обновился: английская версия, меньше лагов на монстрах и снова нужен фидбек первых минут

Привет, DTF. Я разработчик ГИГАХРУЩА.

Короткий апдейт по публичной сборке: английская версия теперь доступна на itch.io и в прямом браузерном билде, а тяжелую просадку FPS на моменте появления пачки монстров / экранного эффекта я поправил. Это была конкретная проблема из внешней проверки, поэтому обновление не про "еще один анонс", а про проверку исправленного входа в игру.

ГИГАХРУЩ / GIGAH|RUSH - бесплатный браузерный survival horror / ARPG shooter про вылазки в безграничную бетонную структуру. Игрок готовит воду, еду, патроны, медицину, документы и оружие, выходит из жилой зоны, торгуется, ищет слухи и контракты, переживает САМОСБОР и пытается вернуться с добычей и последствиями.

Что сейчас стоит проверить:

1. Быстрее ли читается первая цель.
2. Не ломается ли FPS на монстрах и тяжелых экранных эффектах.
3. Понятно ли, зачем перед вылазкой брать припасы.
4. Что хуже всего читается: HUD, карта, инвентарь, торговля или журнал.
5. На каком моменте хочется закрыть вкладку.

Играть:

RU/MyIndie:
https://myindie.ru/games/game/gigahrush

Direct browser build:
https://gigahrush.bileter.workers.dev

itch.io / EN mirror:
https://tenevik.itch.io/gigahrush

Канал проекта:
https://t.me/gigah_rush

Если ловите просадку FPS или темный экран: браузер, устройство, что было на экране и сколько ждали. Я не прошу лайков или рейтингов; нужны конкретные места, которые можно чинить.

Контент-нота: survival horror, оружие, кровь, трупы, монстры, сирены, тревожные события и элементы body-horror. Не NSFW/adult.
```

## Ready Copy - Telegram / VK Short Post

```text
АПДЕЙТ 02.06

EN-версия и исправленная сборка уже лежат на itch и в прямом Cloudflare-билде.

Что изменилось:
- английская версия теперь доступна публично;
- поправлена тяжелая просадка FPS на моменте появления пачки монстров / экранного эффекта;
- direct build и itch-зеркало обновлены.

Играть:
RU/MyIndie: https://myindie.ru/games/game/gigahrush
Direct browser build: https://gigahrush.bileter.workers.dev
itch / EN mirror: https://tenevik.itch.io/gigahrush

Если проверяете текущую сборку, особенно нужны первые 5-10 минут: где теряется цель, что не читается в HUD/карте/инвентаре, и ловится ли еще просадка FPS на монстрах.
```

## Next Actions

1. Monitor GameDev.ru reply `m=6192509#m1` for comments and link retention.
2. Monitor new GameDev.ru release topic `https://gamedev.ru/projects/forum/?id=295635` for comments, moderation and link retention.
3. Owner completes DTF OAuth only if comfortable granting the Yandex app consent; then publish the DTF copy once with preview under `Инди`.
4. Owner opens/logs into VK and Telegram on the current desktop; use the short copy once per owned surface, not as a repeated group blast.
5. Owner logs into forum.indie.ru as `TENEVIK`; post the same short update in the existing devlog thread if that surface is still desired.
