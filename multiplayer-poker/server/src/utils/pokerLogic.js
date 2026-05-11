const rankValue = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const handNames = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

function combos(cards, k) {
  const result = [];
  const helper = (start, chosen) => {
    if (chosen.length === k) return result.push(chosen);
    for (let i = start; i < cards.length; i++) helper(i + 1, [...chosen, cards[i]]);
  };
  helper(0, []);
  return result;
}

function straightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i++) {
    const run = unique.slice(i, i + 5);
    if (run[0] - run[4] === 4) return run[0] === 1 ? 5 : run[0];
  }
  return 0;
}

function scoreFive(cards) {
  const values = cards.map(c => rankValue[c.rank]).sort((a, b) => b - a);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const straight = straightHigh(values);
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts).map(([v, c]) => ({ value: Number(v), count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (flush && straight) return { rank: 8, tiebreakers: [straight], name: handNames[8] };
  if (groups[0].count === 4) return { rank: 7, tiebreakers: [groups[0].value, groups[1].value], name: handNames[7] };
  if (groups[0].count === 3 && groups[1].count === 2) return { rank: 6, tiebreakers: [groups[0].value, groups[1].value], name: handNames[6] };
  if (flush) return { rank: 5, tiebreakers: values, name: handNames[5] };
  if (straight) return { rank: 4, tiebreakers: [straight], name: handNames[4] };
  if (groups[0].count === 3) return { rank: 3, tiebreakers: [groups[0].value, ...groups.slice(1).map(g => g.value).sort((a,b)=>b-a)], name: handNames[3] };
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups.filter(g => g.count === 2).map(g => g.value).sort((a,b)=>b-a);
    const kicker = groups.find(g => g.count === 1).value;
    return { rank: 2, tiebreakers: [...pairs, kicker], name: handNames[2] };
  }
  if (groups[0].count === 2) return { rank: 1, tiebreakers: [groups[0].value, ...groups.slice(1).map(g => g.value).sort((a,b)=>b-a)], name: handNames[1] };
  return { rank: 0, tiebreakers: values, name: handNames[0] };
}

function compareScore(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

export function bestHand(cards) {
  let best = null;
  for (const combo of combos(cards, 5)) {
    const score = scoreFive(combo);
    if (!best || compareScore(score, best) > 0) best = { ...score, cards: combo };
  }
  return best;
}

export function determineWinner(players, communityCards) {
  const active = players.filter(p => !p.folded);
  if (active.length === 1) return { winners: active, handName: 'Everyone else folded' };
  let best = null;
  let winners = [];
  for (const player of active) {
    const score = bestHand([...JSON.parse(player.hand_cards_json), ...communityCards]);
    if (!best || compareScore(score, best) > 0) {
      best = score;
      winners = [player];
    } else if (compareScore(score, best) === 0) {
      winners.push(player);
    }
  }
  return { winners, handName: best?.name || 'Unknown' };
}
