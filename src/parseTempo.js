// parseTempo.js
// Interpreta textos de tempo em português e devolve a duração em milissegundos.
//
// Exemplos aceitos:
//   "30 min"  "5h"  "3d"  "3d e 2h"  "4 horas e 30 min"  "1h30"  "1,5h"
//   "uma hora e meia"  "meia hora"  "2 dias e 3 horas"  "1 semana"  "90 minutos"
// Número sozinho ("30") = minutos.

const SEG = 1000;
const MIN = 60 * SEG;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const SEMANA = 7 * DIA;

// Limite do Discord para timeout: 28 dias
const MAX_MS = 28 * DIA;

const NUMEROS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
  oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30,
};

const UNIDADES = [
  [/^(s|seg|segs|segundo|segundos|sec|secs)$/, SEG],
  [/^(m|min|mins|minuto|minutos)$/, MIN],
  [/^(h|hr|hrs|hora|horas)$/, HORA],
  [/^(d|dia|dias)$/, DIA],
  [/^(sem|semana|semanas|w)$/, SEMANA],
];

function fatorDaUnidade(texto) {
  for (const [re, fator] of UNIDADES) if (re.test(texto)) return fator;
  return null;
}

function normalizar(txt) {
  return String(txt ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * @param {string} entrada  texto digitado pelo moderador
 * @returns {{ ms: number } | { erro: string }}
 */
function interpretarTempo(entrada) {
  let s = normalizar(entrada).replace(/["'“”‘’]/g, '');
  if (!s) return { erro: 'Você não informou o tempo.' };

  s = s.replace(/(\d),(\d)/g, '$1.$2'); // 1,5h -> 1.5h

  // "um", "dois"... -> 1, 2...
  s = s.replace(/\b[a-z]+\b/g, (p) =>
    Object.prototype.hasOwnProperty.call(NUMEROS, p) ? String(NUMEROS[p]) : p
  );

  // "1 hora e meia" / "1 dia e meio" -> 1.5 hora / 1.5 dia
  s = s.replace(/(\d+(?:\.\d+)?)\s*([a-z]+)\s+e\s+(?:meio|meia)\b/g, (_, n, u) => `${parseFloat(n) + 0.5} ${u}`);
  // "meia hora" -> 0.5 hora
  s = s.replace(/\b(?:meio|meia)\b/g, '0.5');

  // separadores: "e", "mais", "and", virgula, +, &
  s = s.replace(/\b(?:e|mais|and)\b|[,+&;]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const re = /(\d+(?:\.\d+)?)\s*([a-z]*)/g;

  // sobrou algo que não é número/unidade?
  const resto = s.replace(re, '').trim();
  if (resto) {
    if (/^(mes|meses)$/.test(resto) || /\b(mes|meses|ano|anos)\b/.test(resto)) {
      return { erro: 'Meses e anos não são aceitos: o Discord limita o castigo a no máximo 28 dias (use dias ou semanas).' };
    }
    return { erro: `Não entendi "${resto}". Exemplos: 30 min, 5h, 3d e 2h, 4 horas e 30 min.` };
  }

  let total = 0;
  let ultimoFator = null;
  let ultimaExplicita = false;
  let achou = false;
  let m;
  while ((m = re.exec(s)) !== null) {
    const valor = parseFloat(m[1]);
    const unidade = m[2];
    let fator;
    let explicita = true;

    if (!unidade) {
      // sem unidade: "30" sozinho = minutos; "1h30" = 1h30min; "2d 5" = 2d 5h
      explicita = false;
      if (ultimoFator === null) fator = MIN;
      else if (!ultimaExplicita) return { erro: 'Faltou a unidade (min, h, d...) em um dos números.' };
      else if (ultimoFator === SEMANA) fator = DIA;
      else if (ultimoFator === DIA) fator = HORA;
      else if (ultimoFator === HORA) fator = MIN;
      else if (ultimoFator === MIN) fator = SEG;
      else return { erro: 'Faltou a unidade (min, h, d...) em um dos números.' };
    } else {
      fator = fatorDaUnidade(unidade);
      if (!fator) {
        if (/^(mes|meses|ano|anos)$/.test(unidade)) {
          return { erro: 'Meses e anos não são aceitos: o Discord limita o castigo a no máximo 28 dias (use dias ou semanas).' };
        }
        return { erro: `Não conheço a unidade "${unidade}". Use s, min, h, d ou semana.` };
      }
    }

    total += valor * fator;
    ultimoFator = fator;
    ultimaExplicita = explicita;
    achou = true;
  }

  if (!achou) return { erro: 'Não encontrei nenhum número no tempo. Exemplos: 30 min, 5h, 3d e 2h.' };

  const ms = Math.round(total / SEG) * SEG;
  if (ms < SEG) return { erro: 'O tempo precisa ser de pelo menos 1 segundo.' };
  if (ms > MAX_MS) return { erro: 'O Discord só permite castigo de até **28 dias**.' };
  return { ms };
}

/** 273000000 -> "3 dias, 3 horas e 50 minutos" */
function formatarDuracao(ms) {
  let s = Math.round(ms / SEG);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const min = Math.floor(s / 60); s %= 60;

  const partes = [];
  if (d) partes.push(`${d} ${d === 1 ? 'dia' : 'dias'}`);
  if (h) partes.push(`${h} ${h === 1 ? 'hora' : 'horas'}`);
  if (min) partes.push(`${min} ${min === 1 ? 'minuto' : 'minutos'}`);
  if (s) partes.push(`${s} ${s === 1 ? 'segundo' : 'segundos'}`);

  if (partes.length <= 1) return partes[0] ?? '0 segundos';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

module.exports = { interpretarTempo, formatarDuracao, MAX_MS };
