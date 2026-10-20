"""Converte il listato (Ed0ardo/QuizPatenteB, MIT) nel formato compatto usato dall'app."""
import json, sys

NAMES = {
 'definizioni-generali-doveri-strada': 'Definizioni generali e doveri',
 'segnali-pericolo': 'Segnali di pericolo',
 'segnali-divieto': 'Segnali di divieto',
 'segnali-obbligo': 'Segnali di obbligo',
 'segnali-precedenza': 'Segnali di precedenza',
 'segnaletica-orizzontale-ostacoli': 'Segnaletica orizzontale e ostacoli',
 'semafori-vigili': 'Semafori e agenti del traffico',
 'segnali-indicazione': 'Segnali di indicazione',
 'segnali-complementari-cantiere': 'Segnali complementari e di cantiere',
 'pannelli-integrativi': 'Pannelli integrativi',
 'limiti-di-velocita': 'Limiti di velocità',
 'distanza-di-sicurezza': 'Distanza di sicurezza',
 'norme-di-circolazione': 'Norme di circolazione',
 'precedenza-incroci': 'Precedenza agli incroci',
 'sorpasso': 'Sorpasso',
 'fermata-sosta-arresto': 'Fermata, sosta, arresto',
 'norme-varie-autostrade-pannelli': 'Autostrade, traino, norme varie',
 'luci-dispositivi-acustici': 'Luci e dispositivi acustici',
 'cinture-casco-sicurezza': 'Cinture, casco, bambini',
 'patente-punti-documenti': 'Patente, punti, documenti',
 'incidenti-stradali-comportamenti': 'Incidenti stradali',
 'alcool-droga-primo-soccorso': 'Alcol, droghe, primo soccorso',
 'responsabilita-civile-penale-e-assicurazione': 'Responsabilità e assicurazione',
 'consumi-ambiente-inquinamento': 'Consumi e ambiente',
 'elementi-veicolo-manutenzione-comportamenti': 'Veicolo e manutenzione',
}

def h(s):
    x = 0x811c9dc5
    for b in s.encode('utf-8'):
        x = ((x ^ b) * 0x01000193) & 0xffffffff
    return format(x, 'x')

src = json.load(open(sys.argv[1], encoding='utf-8'))
out, seen = [], set()
for cid, subs in src.items():
    ch = {'id': cid, 'name': NAMES[cid], 'subs': []}
    for sid, qs in subs.items():
        sub = {'id': sid, 'qs': []}
        for q in qs:
            img = (q.get('img') or '').replace('/img_sign/', '')
            qid = h(q['q'] + '|' + img)
            while qid in seen:
                qid += 'x'
            seen.add(qid)
            sub['qs'].append([qid, q['q'].strip(), 1 if q['a'] else 0, img])
        ch['subs'].append(sub)
    out.append(ch)
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(seen), 'domande')
