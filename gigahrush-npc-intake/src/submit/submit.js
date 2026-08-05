export function localSubmissionInstructions(packId) {
  return [
    `Local export ready for ${packId}.`,
    'If online submit is unavailable, send the ZIP to TENEVIK GAMES through the agreed review channel: mail, DM, Drive or another manual inbox.',
    'Private contact data is used only for review metadata and is not placed inside npc.json.',
  ].join('\n');
}
