import { isLive } from '../engine/calendar'
import { useGame } from '../store'
import { Modal } from './Modal'
import { shortcutsFor } from './shortcuts'

const TURN = [
  { title: 'Read the Briefing', body: 'Your advisor lists what needs you this month, most urgent first. Every item has a button that takes you to the fix.' },
  { title: 'Give your orders', body: 'Upgrades, training, weapons, laws, declaring war and attacks happen the moment you press the button. Research, taxes, the draft and offers to other nations take effect when the month ends.' },
  { title: 'Press Next turn', body: 'Every other nation moves, income arrives, units finish training, and attacks on you play out. A monthly report shows what changed.' },
]

const LIVE_STEPS = [
  { title: 'Press play', body: 'Time flows by itself: a month takes about a minute. Pause any time with Space, and speed it up with 1, 2 and 3. The clock stops while you plan an attack or decide an event, and a new game starts paused.' },
  { title: 'Give your orders', body: 'Upgrades, training, trades, shares and war work the moment you press the button. Research, taxes, the draft and offers to other nations take effect on the 1st of the next month, and the Orders bar says when.' },
  { title: 'Send armies', body: 'An attack in the War Room sends an army out of your military. It marches for days, fights when it arrives, and comes home. Units that are away do not defend your country. Recall an army while it is still on its way out.' },
  { title: 'Watch for armies and missiles coming', body: 'An enemy army shows in red with the days left. You have that time to recall your own armies, raise shields, fire missiles or make peace, which turns armies back. Missiles in the air toward you show as a purple alert with who fired them and the days left; each kind flies for its own number of days.' },
]

const TERMS: [string, string][] = [
  ['Money', 'Comes from taxes, factories and ports. Pays for upgrades, units, their upkeep and your wars.'],
  ['Food', 'Farms grow it; people and soldiers eat it. Run out and your military fights 30% weaker.'],
  ['Influence', 'Political capital. You spend it to declare war, pass laws, sign treaties and put down rebels.'],
  ['Research', 'Universities produce it. You spend it on technologies that unlock units and make them stronger.'],
  ['Stability', 'How content your people are. High taxes, hunger, debt and long wars lower it. Below 30% rebels rise.'],
  ['Division', 'One unit. Infantry, tanks, planes and warships each have attack and defense numbers, and battles use exactly those.'],
  ['Defense Line', 'How much resistance a country has left. Each battle you win pushes it down. At zero the country is yours. It heals in months nobody attacks.'],
  ['Force size', 'How much of your military you send: a probe, the main force, or all in. In a turn game the rest of your army at home fights at half strength until the month ends. In a live game what you send leaves home until it is back.'],
  ['Stance', 'How you fight. Assault is balanced. Blitz breaks the line faster and costs more. Siege is slow, saves lives, and shuts their factories.'],
  ['War bill', 'Every war costs money every month. A small country can fight three wars at once, a big empire more.'],
  ['Settling', 'A conquered country gives about 40% of its output at first and reaches 100% after six months.'],
  ['Oil, steel, goods', 'Oil fuels tanks, planes and warships. Steel builds them. Goods keep your people content. Buy what you lack on the Market in Economy.'],
  ['Cities', 'Each country has cities. Grow them for workers and give each a focus that boosts the whole country.'],
  ['Business', 'Six private sectors grow on their own. Lower business tax, calm people and new technology make them grow faster.'],
  ['Bonds and credit', 'Borrow with bonds and pay interest at the rate fixed when you sold them. A bond that comes due is rolled over while lenders still lend, or paid from the treasury. A nation in the red for 3 months with debt defaults: half of every bond is written off and nobody lends to it for two years.'],
  ['Spending', 'Real money for schools, health and public works (levels 0 to 4) and for pensions, jobless support and housing (0 to 2). More costs more and buys a better life; less saves money and lets things slip.'],
  ['Programs for the people', 'The People tab has 22 programs in five groups: health, learning, work, family and safety. Each is Off, Pilot, National or Universal. Raising one costs influence and then money every month by its level, and its effect phases in over a few months. Cutting one costs stability at once. Programs for calm cost; programs for growth, like courts, public transport and small-business loans, earn most of their cost back. Stability from care has a ceiling, so the first programs help most.'],
  ['Why stability moves', 'The People tab lists every cause of stability with its points, so you can see which lever to pull: taxes, hunger, war weariness, rebels, stretched officials, programs. A campaign (a celebration, a vaccination drive) is a one-off bill for a burst of effect, with a long wait before the next.'],
  ['People and skills', 'Your workers are basic workers, skilled workers, engineers, doctors and scientists. Factories need engineers, universities need scientists, hospitals need doctors. Schools, and the focus you give them, decide the mix. Only people with jobs pay tax.'],
  ['Health and epidemics', 'Healthy people live longer, have more children and riot less. Poor health invites epidemics, which spread to neighbors and cost lives, output and calm. Doctors, health spending, a quarantine and medicine end them.'],
  ['Medicine', 'A seventh research column: Sanitation, Vaccines, Surgery, Genomics and Longevity. Surgery lets doctors return wounded soldiers to the ranks. The last two need a Medical Research Centre or doctors for every need.'],
  ['The bank', 'From a Regional power up you set the interest rate: higher cools prices, lower warms them. You can print money (money now, inflation later), sell bonds for 1, 3 or 5 years, sell war bonds in wartime, steer credit to one sector, and keep a wealth fund. A weak currency makes exports cheap and imports dear.'],
  ['Projects and public works', 'Seventeen national projects, from a rail network and a water network to a fusion plant and a Mars mission, each open at a different size of empire. Each can be built up to three levels: every level costs and takes more, and is worth more but not in proportion. Engineers set the pace, so building many at once slows them all. You can rush a project: pay four months of its bill to bring it two months closer, once a month. Public works spending speeds projects, trade and factories, and makes building cheaper.'],
  ['The space program', 'Economy, Space. Needs Fifth-Generation Fighters. An agency of engineers and astronauts (they come out of the same specialists your factories use, and are paid every month), a launch site, and rockets you develop once (sounding, orbital, heavy-lift, deep-space, interplanetary) and then build one at a time: every launch uses a rocket up. Fly missions up a ladder: a test flight, satellites (communications lift trade and research, weather calm the country, reconnaissance sees every enemy), a crewed orbit, then the Moon, asteroids, Mars and the outer planets. A flight takes months: build, launch, travel, arrive, and a seeded roll decides the launch and the arrival. A failure loses the rocket and payload, costs standing, and can kill a crew. Each mission can be flown in-house (cheap, needs a rocket, talent and experience, and builds experience that makes every launch safer) or hired from a private company (a fixed premium, faster to build, no experience, and companies grow better and cheaper as the world flies more rockets). Probes bring home samples; the Labs turn samples into discoveries (cheaper and safer rockets, life support, in-situ resource use, and spillovers: output, medicine, even a new Frontier technology). To take a world: survey it, land, claim it (influence, and nobody else may build there), then fly the cargo that founds an outpost. Outposts grow into stations and colonies, and carry mines that take years to build: metal for steel, rare metals for money, water and volatiles for oil and cheaper upkeep, helium-3 for the grid and a fusion plant. It is a long-term investment: a mine and its outpost take about ten years to pay back what they cost (about six with the right discoveries), before the rockets and staff that got you there, and an outpost the treasury cannot supply shrinks.'],
  ['Projects in your countries', 'Each country you hold can have its own projects: an industrial park, a tech hub, irrigation, a dam, a resort, a cultural centre, a border fortress, a special economic zone, a mine. Some need a coast, hills, a port or a university. They cost and give more in a bigger country, and they stay with the land if it is conquered. A cultural centre helps conquered land settle.'],
  ['State enterprises', 'The state can buy or seize a business sector and keep most of its profit. It grows at half speed, and seizing one frightens investors.'],
  ['Empire tiers', 'Holding 4, 10, 25 and 60 countries makes you a Regional power, Great power, Superpower and Hegemon. Each tier widens what you can do: interest rates, printing, bonds, projects, laws, the wealth fund, capitals, loans and the World Council. A puppet counts as half. You keep a tier until you fall a tenth below its line.'],
  ['Administration', 'Your officials can run only so many countries at once. Beyond that, stability and output fall. Civic halls, governors, skilled workers, regional capitals and digital government raise the limit. Capitals carry no load.'],
  ['Occupation policy', 'How you hold conquered land: Standard, Autonomy (slow, few rebels), Assimilate (fast, more rebels), or Settle (costly, quick and calm). Bigger empires have more choices.'],
  ['World reaction', 'The bigger you grow, the more the world fears you. Your threat (0 to 100) comes from your empire tier, your share of the world\'s countries, people and output, and your reputation for aggression, and the tier decides how much of it turns into action. Easy rivals never band together. Medium rivals form alliances and blocs against you and join their friends\' wars. Hard rivals also plan joint strikes: several of them declare war and attack your weakest border in the same month (in a live game, on the same day), with at least two months of warning. The Empire desk\'s World reaction tab shows the threat, who is drawing together, what is coming and what you can do: pacts, aid, a better reputation, a Council recognition.'],
  ['Nuclear weapons', 'A Superpower (25 countries) with Hypersonic Missiles can build warheads, one at a time over four months, for money, steel and research, and keep four. From the War Room, a warhead can be fired at any country of a nation you are at war with, so a war with a reason comes first. It destroys the country\'s buildings, factories and army, kills about two thirds of its people, cripples its output for years and leaves rebels in the ruins; an Interceptor Shield stops only a quarter and missile hunters catch few. You must tick a box to confirm. The world never forgives it: your reputation soars, every nation despises you and sanctions you, world tension spikes, and the two strongest alliance blocs declare war on you at once. In a live game it flies for five days and its target sees it coming; making peace before it lands calls it off. Hard rivals that are Superpowers may do the same, but only when desperate or provoked, and never twice in three years.'],
  ['World Council', 'A Superpower may put resolutions to every nation: sanctions on a target, a ceasefire between two others, recognition that clears its reputation, or a trade accord. Votes are weighted by income and you see the projected result first.'],
  ['Academy and commander', 'A military academy sends recruits out already drilled, makes drill cheaper and sharpens combined arms. A commander has a trait: mountains, logistics, blitz, air power or defense.'],
  ['Puppet state', 'Win a war big enough and you can make the loser a puppet: it keeps its land, pays you 12% of its income, and fights beside you in every war. After a year you can annex it: its land, army and treasury join yours.'],
  ['Reason for war', 'A war needs a reason: a border incident, an attack on your ally, a spy caught, sanctions, or a case you build in three months. Without one it costs far more, hurts stability and makes the world distrust you.'],
  ['Reputation', 'Starting wars and taking land make other nations uneasy about you. It fades over a couple of years.'],
  ['Reach', 'You attack across a border or a short sea lane. A port plus warships reaches any coast in the world, and fighters or strike aircraft with a factory as a base reach anything within 7000 km (aerial refuelling and strategic bombers push that out). Ships or planes must be at least a twentieth of your military to carry it. Overseas attacks fight with a penalty.'],
  ['Agencies', 'An intelligence service works abroad (intelligence, cases for war, sabotage, rebels, coups, theft) and a security service works at home. Each level adds a team. Odds are shown first.'],
  ['Frontier weapons', 'Drone Swarms take the first losses and shred tanks. Robot Infantry need no soldiers and never tire your people. Missiles are described below. Each weapon has a counter: shields, fighters, and Cyber Command.'],
  ['Missiles', 'Four kinds, each hurting a country differently. Cruise missiles are cheap and wear down the Defense Line and the factories. Tactical missiles kill a slice of the defender\'s army and do nothing to the land. Hypersonic missiles (from technology and the training queue) crack the Defense Line fast. Ballistic missiles break the line, destroy buildings and kill people, and the world will not forgive them. Fire them from the Missiles section of the War Room: Fire 1, or a Custom number. An attack on land never carries missiles by itself, and each one fired is used up. In a live game a salvo flies for its kind\'s days and lands; in a turn game it lands when the month ends. An Interceptor Shield stops a share, and cruise missiles are the easiest to stop.'],
  ['Missile program', 'In Military, Systems. Each level (1 to 3) costs money and research, opens cruise, then tactical, then ballistic missiles, and sets how many the program can build a month (5, 10, 18). Each missile then costs money and steel, and a ballistic one burns oil. A nation you strike remembers it and will answer, and a rival at war can answer you in kind: keep a shield up and some missiles in store.'],
  ['Aircraft development', 'On Military, Forces, press Develop to open the aircraft tree: sixteen developments in four branches. Interceptors (radar, long-range air-to-air missiles, missile-hunter fighters, an integrated air shield): fighters at home shoot down a share of incoming missiles and drones, so they counter missile strikes and drone swarms (three fighters at home cover everything; slow cruise missiles are easiest to catch, ballistic warheads hardest). Stealth and electronic war: bombers keep their strength when the enemy rules the air, shields and hunters stop less of your strikes, and enemy interceptors go blind. Range and payload: airbases reach farther than 7000 km, landings by air lose less, and bombers push a Defense Line back harder. Unmanned wingmen: stronger drones and fighters. Each development pays its research the day it starts and its money month by month, takes months of work, needs earlier developments, a technology and an empire tier, and uses one of your slots (one at first, two as a Great power). Pause one to free its slot. The attack and defense on the screen are exactly what battles use.'],
  ['Systems', 'Cyber Command, Interceptor Shield, AI Battle Command, Quantum Codebreaking, Orbital Network and Nano-armor are programs you buy in three levels. They cost upkeep and each has a weakness.'],
  ['Stocks', 'Made-up companies in the countries you hold, at most two in a very developed one. Buy shares to take a stake: a board seat at 25% lets you tell a company what to do (pay dividends, expand its sector, or specialize for research, cheaper units, income and more), at full strength from 51%. If another nation takes the country, it takes your shares.'],
  ['Factions', 'The Faction desk (F) lets countries work like a company they own together. Found one (15 influence), invite friends or rivals, and members put in money, oil, steel, goods, food and soldiers: the common pool. Your ownership share grows with what you put in. Votes follow the charter: one member one vote, or weighted by share. Anyone can propose a country; members vote Yes or No, and a notice tells you when a vote needs you. A vote passes the moment more than half of the weight says yes, fails on a tie or when half says no, and at the end of its second month it is decided by the votes cast if at least half the weight spoke.'],
  ['Joint wars', 'A passed war vote declares the war: a member with a reason declares it (the proposer pays 10 influence with a reason, 60 without, and carries the blame for aggression), and every member that is free to joins. The pooled soldiers attack as one army each month, with the lead member\'s training, weapons and technology. Conquered countries go to members by ownership share (or to the proposer, by charter), and so does the treasure. The pool pays the army\'s upkeep and buys its oil and food; if it cannot, members are charged by share and unpaid soldiers desert. Pooled soldiers do not defend their home country.'],
  ['Taking money out', 'What you put in is locked for two months. You take back what you put in, in kind: money for money, tanks for tanks. If the pool lost anything in war or upkeep, every claim shrinks by the same share. Soldiers stay while the faction is at war. Leaving returns your claim less 10% (or nothing, under a forfeiting charter); you cannot pull money out of a faction in any other way.'],
  ['Live contracts', 'A trade deal can be a live contract: a start up to six months away, collateral that is held until it ends, and a promise to join the other side\'s wars. It runs by itself every month. A nation that breaks it loses the collateral, its reputation, and hands the other side a reason for war. Members can also put a supply contract to the faction vote: send the pool oil or steel every month, and be paid for it.'],
  ['Empire and governors', 'Every country you hold is listed together in Economy. A governor upgrades a country each month on a plan you pick.'],
]

export function Help() {
  const open = useGame((s) => s.helpOpen)
  const setHelp = useGame((s) => s.setHelp)
  const game = useGame((s) => (s.helpOpen ? s.game : null))
  const online = useGame((s) => s.online?.status === 'playing')
  if (!open || !game) return null
  const live = isLive(game)
  const steps = live ? LIVE_STEPS : TURN
  const total = Object.keys(game.regions).length
  return (
    <Modal
      title="How the game works"
      kicker="Worlds of Others"
      onClose={() => setHelp(false)}
      footer={
        <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={() => setHelp(false)}>
          Got it
        </button>
      }
    >
      <p className="text-[15px] text-white/85">
        You run a country{live ? ' as the days pass' : ', one month at a time'}. <strong>To win</strong>, hold the whole world: all {total} countries yours or puppets of yours. It is a long game. A war needs a reason, so build a case, use your agencies and answer the crises in the news. You lose if your nation is wiped out.
      </p>
      <h3 className="text-[16px] font-semibold mt-5 mb-2">{live ? 'A live game' : 'A turn'}</h3>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex-none w-7 h-7 rounded-full bg-[#0a84ff] text-white text-[14px] font-semibold flex items-center justify-center">{i + 1}</span>
            <div>
              <div className="text-[15px] font-semibold">{s.title}</div>
              <p className="text-[14px] text-white/80">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {online && (
        <p className="mt-3 text-[14px] text-white/80 rounded-xl bg-[#0a84ff]/15 border border-[#0a84ff]/40 px-3 py-2.5">
          <strong>Playing with friends.</strong> Everyone plans the same month at once. Press <strong>Ready</strong> when you are done (press it again to keep planning). The month moves on when everyone is ready or the timer ends. Attacks are planned now and play out at month end, so nobody wins by clicking faster. A surprise decision comes to each player separately and never holds the month: if you do not choose, your ministers take the first option. There is no undo online, since your orders are already on their way. If everyone leaves, any player can reopen the room from <strong>Saved games</strong> under Play with friends, and the others take their seats back with the same code.
        </p>
      )}
      <h3 className="text-[16px] font-semibold mt-5 mb-2">Words you will see</h3>
      <dl className="space-y-2">
        {TERMS.map(([term, meaning]) => (
          <div key={term} className="grid grid-cols-[110px_1fr] gap-3 text-[14px]">
            <dt className="font-semibold">{term}</dt>
            <dd className="text-white/80">{meaning}</dd>
          </div>
        ))}
      </dl>
      <h3 className="text-[16px] font-semibold mt-5 mb-1">Keys</h3>
      <p className="text-[14px] text-white/75">{shortcutsFor(isLive(game))}</p>
    </Modal>
  )
}
