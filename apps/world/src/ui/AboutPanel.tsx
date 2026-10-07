import profiles from '@theote/npcs/data/characters.json';
import lore from '@theote/npcs/data/lore.json';

export function AboutPanel() {
  return <div className="about-panel">
    <header className="about-hero"><div className="about-emblem" aria-hidden="true"><i/><i/><i/><i/></div><h2>Theote</h2><p>The ends of the earth</p><span>Um mundo pequeno onde vidas continuam mesmo quando ninguém está olhando.</span></header>
    <section className="about-section"><h3>Os nomes do mundo</h3><dl className="about-glossary">
      <div><dt>Theote</dt><dd>Nome do projeto e deste mundo observável. A expressão inglesa <em>The ends of the earth</em> significa “os confins da Terra”.</dd></div>
      <div><dt>Cardial</dt><dd>Serviço interno de inteligência de cada morador. Cada instância acompanha a identidade, as escolhas, as memórias, as emoções e os vínculos daquela pessoa. Cardial não é o nome do mundo.</dd></div>
      <div><dt>Vale do Começo</dt><dd>O último refúgio habitável da Terra.</dd></div>
      <div><dt>O Abalo do Grito</dt><dd>O desastre depois do qual Cesar ergueu as muralhas. O calendário recomeça no ano 05 após o Abalo.</dd></div>
      <div><dt>Moedas</dt><dd>{lore.currency} Para quem observa o mundo: cada morador recebe uma moeda ao completar 20 interações sociais. Entregar moedas não conta como interação.</dd></div>
    </dl></section>
    <section className="about-section about-story"><h3>A história completa do Vale</h3><p>{lore.history}</p><p>{lore.outside}</p><p>{lore.resources}</p><p>{lore.goals}</p><p>Desde o ano 05 após o Abalo do Grito, os moradores cuidam da vila e procuram uma forma de ampliar o refúgio sem abrir caminho para os duendes.</p></section>
    <section className="about-section"><h3>Quem vive aqui</h3><p>Sete pessoas têm casas próprias. Ka e Ba são irmãos; Ra e Ni também. Na, An e Sa chegaram à vila ampliada.</p><div className="about-houses">{profiles.map(person=><div key={person.id}><strong>{person.name}</strong><span>Casa {person.home.slice(-1)}</span></div>)}</div></section>
    <section className="about-section"><h3>Como a vida passa</h3><ul>
      <li>Um dia do mundo dura 30 minutos reais. A noite avança mais rápido que o dia.</li>
      <li>Cada morador decide seus passos separadamente. Pode caminhar, visitar lugares, dormir, se aproximar ou falar com quem está por perto.</li>
      <li>Uma conversa só pode acontecer a até dois metros. Quem entra na roda pode ouvir e participar; quem sai deixa de receber as falas.</li>
      <li>Às 12:00, os moradores se reúnem no largo e conversam até 12:15.</li>
      <li>Fome e sede aumentam com o tempo. Cada quadrado caminhado acrescenta 0,0005% de fome e 0,005% de sede; cada fala acrescenta 0,0005% de sede. A banca vende 50 alimentos e bebidas. Maçã e pão aliviam 20% e 40% da fome; água e suco aliviam 40% e 20% da sede. Os outros itens aliviam menos.</li>
      <li>Um morador pode convidar uma ou mais pessoas para conversar em um local, dia e hora exatos. Cada convidado escolhe se aceita; perto da hora, decide se vai ao encontro. A aba Convites registra respostas e presenças.</li>
      <li>Trinta animais de dez tipos circulam pela vila. Pássaros pousam e voam. Ao perceber um animal a até quinze quadrados, um morador pode se aproximar, observá-lo e chamar alguém para vê-lo.</li>
      <li>Os moradores exploram lugares novos e guardam lembranças de episódios e descobertas. O duende acorrentado fala com quem se aproxima da barreira e pode influenciar opiniões.</li>
      <li>Uma pessoa pode propor por escrito um plano que disse em conversa. A outra pode assinar ou recusar; a aba Acordos mostra cada decisão. O registro não executa a promessa automaticamente.</li>
      <li>As ações e conversas ficam registradas. Lembranças episódicas, opiniões e descobertas entram nas decisões e falas futuras. Ao fim de cada dia, as lembranças também são resumidas.</li>
      <li>A energia diminui enquanto estão acordados. O despertar das 09:00 acontece automaticamente.</li>
    </ul></section>
    <section className="about-section about-technology"><h3>Por trás de Cardial</h3><p>O Respan escolhe entre ações disponíveis; o Ling escreve as falas. Se o Ling atingir limite de uso ou crédito, o Mistral Nemo assume as conversas. As chamadas passam pelo OpenRouter, e o menu “Consumo de IA” mostra tokens e custos por morador, modelo e período.</p><p>O mundo, as posições e os registros ficam no servidor e no PostgreSQL. A tela acompanha as mudanças em tempo real por WebSocket.</p></section>
  </div>;
}
