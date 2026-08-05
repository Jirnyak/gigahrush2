# PR 43 - Pikabu/GamePush v3 Asset Follow-Up

Date: 2026-05-29.

Time window: 2026-05-29 02:05-02:16 UTC / 03:05-03:16 BST.

Scope: owner reported that the new build was uploaded to the Pikabu/GamePush project; this pass handled the non-legal remainder visible in the GamePush panel: promo image assets, Distribution recheck and basic hosted v3 availability.

## Result

GamePush project `28314` now shows `Actual draft version: 3` on Distribution. The v3 hosted build is reachable, and the top Distribution blockers for missing `Icon 1024x1024`, `Cover 1920x1080` and landscape screenshots disappeared after promo asset upload/generation.

Still blocked for owner/legal input: GamePush continues to show the `My Company` warning. It asks for owner or organization data needed for contract signature:

- owner's name;
- Tax ID Number / INN;
- phone number;
- date of birth or company establishment date.

These fields are personal/legal data and were not filled by the agent.

No public Pikabu catalog URL, public announcement, post, email, vote, rating, duplicate submission, payment/legal agreement or distribution final approval action was made.

## Browser Actions

Opened the authenticated GamePush panel:

- Promo Materials: `https://gamepush.com/panel/projects/28314/promo-materials/`
- Distribution: `https://gamepush.com/panel/projects/28314/distribution/`

Uploaded the existing local GamePush promo pack:

```txt
../gatbage/tmp/media/gamepush_promo_2026-05-28/gigahrush_icon_1024.png
../gatbage/tmp/media/gamepush_promo_2026-05-28/gigahrush_cover_1920x1080.png
../gatbage/tmp/media/gamepush_promo_2026-05-28/gigahrush_screen_1_underhell_gate_1280x720.png
../gatbage/tmp/media/gamepush_promo_2026-05-28/gigahrush_screen_2_living_monster_1280x720.png
../gatbage/tmp/media/gamepush_promo_2026-05-28/gigahrush_screen_3_inventory_1280x720.png
../gatbage/tmp/media/gamepush_promo_2026-05-28/gigahrush_screen_4_alife_1280x720.png
```

The GamePush Promo Materials page then showed icon and cover slots without the upload placeholder, and `Screenshot (album)` changed to `Upload more`.

Ran `Generate for all platforms`, selected `Pikabu`, with `English` and `Russian` selected by the modal. The modal finished with:

```txt
Congratulations!
Assets are ready, download has started now.
```

Downloaded `~/Downloads/assets.zip` existed but contained only an empty `Pikabu/` directory. Treat that downloaded ZIP as a GamePush generator artifact, not as the source of truth; the Distribution page is the useful recheck.

## Distribution Recheck

After upload/generation, Distribution showed:

```txt
Distribution status: In progress
Pikabu
Actual draft version: 3
```

Top warning remaining:

```txt
You have not filled in information about yourself or the organization yet.
You can fill it in advance in the My Company section.
The data is needed for contract signature.
```

The earlier top warnings for missing `Icon 1024x1024`, missing `Cover 1920x1080` and missing screenshots were no longer present.

The `Current project version` section still showed icon/cover/screenshot fields as `*Empty*`, but the same section also says:

```txt
Please fill in information about your game after we have accepted the game
```

So the current operational interpretation is: promo-material blockers are cleared for the in-progress Distribution pass; final project-version media may still need review or post-acceptance filling if GamePush asks.

## Hosted v3 Check

`curl -I https://s3.eponesh.com/games/28314/v3/` returned:

```txt
HTTP/2 200
content-type: text/html
content-length: 11246051
last-modified: Fri, 29 May 2026 01:53:56 GMT
etag: "0412ca4f04557fef3527c997b0dd3870"
```

The hosted HTML contains:

```txt
<title>ГИГАХРУЩ - САМОСБОР</title>
gigahrush-portal" content="pikabu"
```

Browser opened `https://s3.eponesh.com/games/28314/v3/?portal=pikabu&qa=1`; document state was `complete`, title was `ГИГАХРУЩ - САМОСБОР`, and two visible canvases were present at `1200x883`.

This was not a full GamePush sandbox/cloud-save QA. Console capture, `progress` cloud-save save/load, pause/audio behavior, mobile scaling and moderator-facing sandbox checklist still need a real QA pass.

## Asset Verification

Dimensions verified with `sips`:

```txt
gigahrush_icon_1024.png: 1024x1024
gigahrush_cover_1920x1080.png: 1920x1080
gigahrush_screen_1_underhell_gate_1280x720.png: 1280x720
gigahrush_screen_2_living_monster_1280x720.png: 1280x720
gigahrush_screen_3_inventory_1280x720.png: 1280x720
gigahrush_screen_4_alife_1280x720.png: 1280x720
```

SHA-256:

```txt
616ba23a3956f66857e8390c872c53a8d1f5da37935c7842680d407d8c418028  gigahrush_cover_1920x1080.png
461e771c33361579ecf8418b5ccbae071f21a07dff75fdf740ed9a1ca587bcb8  gigahrush_icon_1024.png
e8f757487e8a4038a15f9e20be313385a472b14d8a8cca763001ae2bd293fe0b  gigahrush_screen_1_underhell_gate_1280x720.png
ba49113e22ac9d32faeec5cd7b7831628084c897b18cdec1f7d6c2b84c311c5a  gigahrush_screen_2_living_monster_1280x720.png
5ba5ca99a73fa276cc57afe641034ecfdf578965cc0ed1731a5c5042300bb5e4  gigahrush_screen_3_inventory_1280x720.png
a0678b5f998de15cc665e8117c3d5cb859fec38fcc89a84fe515dd322fb5118f  gigahrush_screen_4_alife_1280x720.png
```

## Next Actions

1. Owner fills `https://gamepush.com/panel/account/company/` with real legal/personal data if they are comfortable proceeding with GamePush/Pikabu contract requirements.
2. Run GamePush `Test game` / sandbox QA for v3: launch, console, pause/audio, scaling, input, mobile and `progress` cloud-save.
3. Watch the moderator chat and Distribution status; do not create a duplicate Pikabu submission.
4. Do not announce a public Pikabu release until moderation accepts the game and a public catalog URL exists.
