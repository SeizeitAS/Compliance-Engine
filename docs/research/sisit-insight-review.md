# Review of sisit.no/innsikt: what the compliance engine should add

**Date:** 2026-11-16. **Status:** complete screening of the archive, selective deep reading.

## Method and limits
- The archive index lists 75 article pages (the 77 links found include the index and a JSON feed). All 75 were downloaded and screened by title, summary, date and keyword frequency (eIDAS, EUDI, lommebok, passport, MiCA, hvitvasking, sanksjon, travel rule, Compact, etc.). The appendix lists all of them.
- About 15 articles were read in substantial part: Midnight Passport, Digdir/JavaZone, "Beviset uten avsloringen", Midnight roadmap Q4 2026 to Q1 2027, Ledger 9, MiCA Travel Rule, the AML cost article, assetprice, Nightframe/EUDI sandbox, NATO delivery proof, NAV wallet, Binance hack, the two US-politics articles, CIP-0113, and the MCP/EUID sales article. The rest were screened, not read line by line. "Background" in the appendix means no direct bearing on this repo, judged from title and keyword hits, so a miss is possible.
- These are the publisher's own articles. They usually separate established fact, announced plans and their own analysis, and this review keeps that separation: **[fact]** = reported by the article from a cited source, **[plan]** = announced, not delivered, **[opinion]** = Sisit's analysis. Primary legal and technical sources were not re-checked; items marked **verify** need that before any design decision.

## Answers to the three questions
### Midnight Passport (article 2026-09-08, roadmap 2026-10-23)
- **[fact]** A repository under the `midnightntwrk` GitHub organisation with no public description. Charles Hoskinson demoed it in April 2026: a QR code that gives a new user a wallet in under 60 seconds, with no seed phrase and no key handling by the user.
- **[fact]** Seven-layer architecture, six publicly named: wallet abstraction, trusted execution environments, encryption keychains, an account model, a dApp runtime, chain abstraction. The seventh is not public.
- **[plan]** Passport SDK v1 in Q4 2026 (accounts without seed phrases, user-owned data, delegation to agents). Passport v2 in Q1 2027 with decentralised identifiers (DIDs), verifiable attestations and a **registry of approved issuers**, plus a UI for choosing which apps see which attestations. Quarters only, no dates.
- **[opinion]** It does not replace BankID or the EUDI wallet. Attestations such as "of legal age" still need a trusted source.
- **What it means here:** Passport is an onboarding and wallet layer, not a compliance feature. It matters to this project in two ways. First, the v2 issuer registry is the missing trust anchor for accepting attestations in the AML gate. Second, the assetprice article plans self-service API keys via Passport. Recommendation: keep it behind our own interface, spike after SDK v1 ships (CE-11, now defined).

### eIDAS 2.0 / EUDI Wallet
- **[fact per articles]** Regulation (EU) 2024/1183 entered into force 20 May 2024. Member states must offer a wallet by December 2026. It is **not yet incorporated into the EEA agreement**; Norwegian implementation is expected via regulation under the trust services act once it is. One article says Digdir aims for introduction by 2030, which conflicts with the December 2026 EU deadline: **verify** the Norwegian timeline before promising anything.
- **[fact]** Standards: OpenID4VP (exchange), SD-JWT VC and ISO mdoc (credentials). Digdir runs a sandbox (opened October 2025) with a synthetic-data issuer ("Bevisporten") for PID and other attestations, a demo verifier and demo wallet.
- **[opinion]** SD-JWT hides fields but is not automatically unlinkable (batch one-time issuance is needed); ZK proofs add derived claims ("valid attestation from an approved issuer") without revealing the credential or issuer.
- **Strong, directly usable finding:** Ledger 9 (mainnet 2026-11-06) adds built-in ECDSA, secp256k1 and Keccak, and the Compact toolchain has had P-256 (the usual EUDI signing curve), Ed25519 and sha512 verification since 0.35. A circuit can therefore verify an issuer signature on an EUDI credential locally and publish only the proof. That is the missing front half of `AML_Gate`: today it takes a bare key; it should take a signed credential. **verify** against the toolchain docs.

### Business wallet / virksomhetslommebok
- **[fact]** Bronnoysundregistrene's proposed wallet is a digital company folder (organisation number, board, powers of attorney, certifications) with issuer-side revocation. Brreg takes part in the EU Digital Wallet Consortium pilot. The Commission proposed a European Business Wallet regulation on 2025-11-19, COM(2025) 838, still before Parliament and Council: unique EU-wide business identifier, attestations, mandates; mandatory acceptance by public bodies, voluntary for business.
- **[fact]** EUID caveat: legally defined only for companies in the commercial register. The sandbox uses NOFOR for all Norwegian organisations; Digdir recommends using the last nine positions as the organisation number. Design rule from the article: store the full EUID, look up in Enhetsregisteret by organisation number.
- **Use here:** KYB for legal entities (authorised signatory of a registered entity who is not sanctioned), and supply-chain proofs where Ledger 9 contract-to-contract calls let one proof cover every tier without revealing tiers to each other.

## Further elements the archive suggests
| # | Element | Evidence in the archive | Why it fits this engine | Backlog |
|---|---|---|---|---|
| 1 | **Credential intake: EUDI (SD-JWT VC / mdoc) into the AML circuit** | Ledger 9; Digdir/JavaZone; "format bridge" idea in the Congress article | Replace the self-asserted subject key with an issuer-signed credential verified in-circuit (P-256). | CE-9 |
| 2 | **Business wallet and EUID handling (KYB)** | Beviset uten avsloringen; MCP/EUID; NATO | Entity-level gate; EUID storage rule; revocation. | CE-10 |
| 3 | **Midnight Passport integration** | Passport; roadmap | Issuer registry as trust anchor; wallet onboarding. | CE-11 |
| 4 | **Travel Rule (TFR II) proof** | Reisereglen artikkel | Prove sender is KYC-identified, controls the (unhosted) wallet, and is not on a sanctions list, without sending personal data. Directly maps to the blueprint's AMLR row. | CE-16 (new) |
| 5 | **Reusable KYC / reliance on prior due diligence** | NOK 1.2 bn AML article (thesis by Silje Sund, via Regnskap Norge; shared-registry lobbying) | A proof "vetted by an authorised bank" that an accountant or auditor can rely on. | CE-17 (new) |
| 6 | **Auditor access: viewing keys and discloseTo** | Roadmap (Q1 2027 **[plan]**, spec unpublished) | The blueprint wants auditor-attested monthly Proof-of-Reserves; scoped, expiring, revocable auditor access is how. Do not promise customers before the spec is published. | CE-18 (new) |
| 7 | **CIP-0113 interoperability** | Cardano mainnet 2026-10-07 **[fact]** | Tokens enforce KYC and sanctions rules in the ledger; a Midnight proof could supply the yes/no. How a Midnight result reaches a Cardano validator is unresolved. | CE-19 (new) |
| 8 | **Toolchain alignment** | Ledger 9; toolchain 0.36.0 with events requiring indexer 4.4.101 and Midnight.js 5.0.0 | The blueprint says "Compact 0.5.1"; the articles describe toolchain 0.35 and 0.36.0 and ledger 9 (mainnet) with Preprod still on ledger 8. Treat "0.5.1" as unverified, pin real versions, and rebuild for ledger 9. | CE-5 |
| 9 | **Assetprice anchoring design** | assetprice article | Leaves are salted hashes of (currency, timestamp, price, sources) because prices are low-entropy; only the root is anchored; ZK membership proof so prices are not revealed. Currently **not built** ("no blockchain integration, no salting, no Compact circuit"). | CE-8 |
| 10 | **Sanctions screening in token flows and agent commerce** | MCP/EUID, CIP-0113 | Same non-membership proof reused by buyers' agents ("not on a sanctions list"). | CE-2 |

## Corrections to the blueprint and docs
1. **Compact version:** resolved in `docs/toolchain.md`: "0.5.1" is not a language version. The Business 20 repo's own compiler output reports language 0.23.0 (compiler 0.31.0).
2. **Weighting window:** the blueprint says a rolling 30-day correlation; the assetprice article says weights are recalculated weekly. Align the documents with what the code does (assetprice `calculate_price_source_leadership.php`).
3. **Anchoring status:** the blueprint calls the Midnight Merkle-anchored API a roadmap item; the article states plainly it is a plan with no code. Keep that wording.
4. **Waters text:** the archive describes it as a House Democrats' proposal (Section 603(b)(20), monthly proof of reserves attested by a licensed auditor), not law. The blueprint already marks it a draft; keep it out of any "legal requirement" claim.
5. **Dates:** AMLR applies from 2027-07-10 and MiCA is fully applicable in the EU (transitional periods ended 2026-07-01 per the articles). Whether and when each applies in Norway depends on EEA incorporation and Finanstilsynet: **verify**, as the articles themselves say.
6. **NIGHT is unshielded:** Midnight's documentation (cited in the Binance article) says NIGHT balances and transfers are public. A proof of reserves for NIGHT holdings does not need hiding; shielded tokens and DUST are different.

## Out of scope for now
NIS2 / digitalsikkerhetsloven reporting, the Transparency Act, EHDS health data, the AI Act consultation response, the bookkeeping regulation proposal (ZK proofs as storage format, section 7-2), tokenised real estate and aquaculture compliance, Midnight market commentary. They share the ZK pattern but not this repo's regulatory scope. NIS2 stays as backlog CE-12.

## Cautions
- Several roadmap items (viewing keys, discloseTo, Passport v2, in-contract proof verification, Nightstream post-quantum proofs) are quarters-only plans. Build behind interfaces; promise nothing to customers.
- Deployed contracts cannot be changed, so test on a testnet first (the roadmap article makes this point).
- Per the articles, AML and KYC are not Midnight features; we have to build the compliance logic ourselves.
- Keeping personal data off-chain and making keys deletable is stated as design intent; the GDPR assessment of that pattern is explicitly unresolved.

## Appendix: all 75 archive pages screened
| Date | Article | Topic tag |
|---|---|---|
| 2026-05-23 | [AI-agenter på blokkjeden: BMW og Lufthansa tar steget ut på Cardano!](https://sisit.no/innsikt/ai-agenter-cardano-bmw.html) | Background |
| 2026-05-23 | [Aktiviteten øker på Cardano: Hva betyr dette for Midnight?](https://sisit.no/innsikt/cardano-aktivitet-midnight.html) | Background |
| 2026-05-23 | [Fra stikkprøver til full revisjon: Cardano Foundation oppgir nær halvert revisjonskostnad](https://sisit.no/innsikt/cardano-revisjon-50-prosent-kostnadsreduksjon-grant-thornton-leccia.html) | Background |
| 2026-05-23 | [Cardano & Syngenta: Reell verdi for tusenvis av bønder i India – og hva betyr dette for Midnight?](https://sisit.no/innsikt/cardano-syngenta-rwa.html) | Background |
| 2026-05-23 | [Praktisk bruk: Selskapsavtaler og styreinterne fullmakter med Midnight](https://sisit.no/innsikt/compact-dao-selskapsavtale.html) | Background |
| 2026-05-23 | [Norsk teknologigjennombrudd: Iagon kobler Fireblocks til Cardano](https://sisit.no/innsikt/iagon-fireblocks-cardano.html) | Background |
| 2026-05-23 | [Hvorfor Midnight er en nødvendighet for norsk informasjonssikkerhet og lovverk](https://sisit.no/innsikt/midnight-norsk-sikkerhet.html) | Background |
| 2026-05-23 | [Cardano og Scorechain: Infrastrukturen for MiCA er klar](https://sisit.no/innsikt/scorechain-cardano-mica.html) | MiCA / AML tooling |
| 2026-05-24 | [Neste fase for RWA: Hvorfor personvern definerer adopsjonen](https://sisit.no/innsikt/rwa-privacy-zoniqx.html) | Background |
| 2026-05-25 | [Krise i Hytte-Norge: Kan Cardano og smarte kontrakter løse floken?](https://sisit.no/innsikt/cardano-hytte-norge-rwa.html) | Background |
| 2026-05-25 | [Kan Cardano gjøre boligdrømmen billigere?](https://sisit.no/innsikt/cardano-proptech-boligbygging.html) | Background |
| 2026-05-25 | [The Gig Economy Paradox: How Decentralized Labor Destabilizes the Sovereign State](https://sisit.no/innsikt/gigeconomy.html) | Background |
| 2026-05-25 | [Gig-økonomiens paradoks: Hvordan desentralisert arbeid destabiliserer nasjonalstaten](https://sisit.no/innsikt/gigokonomi.html) | Identity / tax |
| 2026-05-25 | [Midnight og Monument Bank: Fremtidens bankvesen på blokkjeden](https://sisit.no/innsikt/monument-bank-midnight.html) | Banking / MiCA |
| 2026-05-25 | [The Crucible of Voltaire: Is Cardano’s dRep Democracy Leading to Autocracy?](https://sisit.no/innsikt/the-crucible-of-voltaire.html) | Background |
| 2026-05-26 | [Den digitale jernbanen for HMS og maskinforvaltning: Slik knuser vi dokumentasjons-jungelen](https://sisit.no/innsikt/hms-digital-jernbane-mef.html) | Background |
| 2026-05-26 | [Dokumentasjonsfellen i NYTEK23: Slik kan ny personvern-teknologi redde oppdretterne](https://sisit.no/innsikt/nytek23-personvern-havbruk.html) | Background |
| 2026-05-27 | [Fra 11 ansatte til milliardkontrakter: Hvem bygger verktøyet som løser MEFs største anbudsfloke?](https://sisit.no/innsikt/mef-store-anbud-midnight.html) | Background |
| 2026-05-27 | [Midnight v1.0.0 er her: Nå blir personvernvennlige applikasjoner produksjonsklare](https://sisit.no/innsikt/midnight-v1-produksjonsklar.html) | Platform |
| 2026-05-29 | [Kan ny personvern-infrastruktur avlyse datasenter-krisen?](https://sisit.no/innsikt/personvern-infrastruktur-datasenter-krisen.html) | Background |
| 2026-05-30 | [Drowning in Paperwork: The Administrative Tax Burden Choking the Salmon Industry](https://sisit.no/innsikt/aquaculture-tax-compliance-privacy.html) | Background |
| 2026-05-30 | [Lederne langs kysten kveles av papir: Dokumentasjonsplikten har blitt en "skatt oppå skatten"](https://sisit.no/innsikt/dokumentasjonsplikten-lakseskatt.html) | Background |
| 2026-06-01 | [Den nye medisinen mot fragmenterte data: Hvorfor datasiloer ikke kan løses med gårsdagens IT-verktøy](https://sisit.no/innsikt/datasiloer-it-verktoy.html) | Background |
| 2026-06-07 | [Hvorfor lokal generering av ZK-bevis knuser VPN-databaser og tradisjonelle IT-siloer](https://sisit.no/innsikt/zk-bevis-knuser-vpn-siloer.html) | Background |
| 2026-06-09 | [Den skjulte tidstyven: Hvorfor dagens kjørebøker feiler på både kontroll og personvern](https://sisit.no/innsikt/elektronisk-kjorebok-personvern-autobook.html) | Background |
| 2026-07-10 | [Circle får bankgodkjenning fra OCC — men er det egentlig en «bank»?](https://sisit.no/innsikt/circle-occ-artikkel.html) | Background |
| 2026-07-12 | [The NOK 1.2 Billion Compliance Trap: Why the Accounting Industry Is Waiting for Midnight](https://sisit.no/innsikt/article-aml-midnight-en.html) | AML reuse |
| 2026-07-12 | [Den 1,2 milliarder kroner store etterlevelsesfellen: Hvorfor regnskapsbransjen venter på Midnight](https://sisit.no/innsikt/artikkel-hvitvasking-midnight.html) | AML reuse |
| 2026-07-16 | [Fire børser, én verifiserbar pris: Kan assetprice spare revisor og Skatteetaten for timevis av kontrollarbeid?](https://sisit.no/innsikt/assetprice.html) | Assetprice |
| 2026-07-17 | [Reisereglen ingen snakker om: Hva MiCAs opplysningsplikt betyr for norske kryptoaktører](https://sisit.no/innsikt/mica-opplysningsplikt-kryptooverforing.html) | Travel Rule |
| 2026-07-17 | [Loven som ikke helt finnes ennå: Hva NIS2 vil koste norske virksomheter når den treffer](https://sisit.no/innsikt/nis2-digitalsikkerhetsloven-zero-knowledge.html) | NIS2 |
| 2026-07-20 | [KI-agenter spyr ut kode ingen forstår: Kan Cardano Midnight løse IT-bransjens nye milliardsmell?](https://sisit.no/innsikt/2026-07-20-kognitiv-gjeld-ki-kode-cardano-midnight.html) | Background |
| 2026-08-11 | [Helsedata uten grenser: Hvem løser fragmenteringsproblemet Europa selv peker på?](https://sisit.no/innsikt/helsedata-uten-grenser-ehds-midnight.html) | EHDS |
| 2026-08-11 | [Hvem eier Norges digitale fremtid? Lærdommen fra de ti oljebud](https://sisit.no/innsikt/hvem-eier-norges-digitale-fremtid.html) | Background |
| 2026-08-11 | [Kvotefellen: Kan fiskerne bevise lovlig fangst uten å avsløre hvor fisken står?](https://sisit.no/innsikt/kvotefellen-ers-fiskeri-zk-bevis.html) | Background |
| 2026-08-11 | [Ny lov om datadeling: Hva løser den egentlig?](https://sisit.no/innsikt/ny-lov-datadeling-personvern-zk-bevis.html) | Background |
| 2026-08-11 | [Regelkaoset gjør boligene dyrere: Kan etterlevelse gjøres bevisbar i stedet for byråkratisk?](https://sisit.no/innsikt/regelkaos-boligbygging-compact-etterlevelse.html) | Background |
| 2026-08-18 | [KI-loven på ny høring: To spørsmål debatten bør stille seg](https://sisit.no/innsikt/ki-loven-horingssvar-verifiserbar-dokumentasjon.html) | AI Act |
| 2026-08-18 | [SECs nye «safe harbor»: Hva betyr det for norske Midnight-utviklere?](https://sisit.no/innsikt/sec-safe-harbor-midnight-zk-bevis.html) | Regulation (US) |
| 2026-08-19 | [Datasentre og skjønn: Hva Ekofisk-tanken faktisk lærer oss om forutsigbarhet](https://sisit.no/innsikt/datasentre-skjonn-ekofisktanken.html) | Background |
| 2026-08-20 | [Leverandørlåsing: Kan kommunene bytte leverandør uten å bytte data?](https://sisit.no/innsikt/leverandorlasing-kommuner-dataportabilitet.html) | Background |
| 2026-08-21 | [Vi har allerede skrevet innspillet til Finansdepartementet – vi venter bare på teknologien](https://sisit.no/innsikt/klar-til-hoering-bokforingsforskriften.html) | Accounting rules |
| 2026-08-22 | [Likviditetssvampen og infrastrukturen: Hva Bitcoins beste uke på tre år faktisk betyr for oss som bygger på Midnight](https://sisit.no/innsikt/artikkel-bitcoin-midnight.html) | Background |
| 2026-08-24 | [Sony åpner dørene for NIGHT: Hva betyr S.BLOX-notering for norske Midnight-utviklere?](https://sisit.no/innsikt/sony-sblox-night-midnight.html) | Background |
| 2026-08-25 | [Beviset uten avsløringen](https://sisit.no/innsikt/beviset-uten-avsloringen.html) | Business wallet |
| 2026-08-31 | [Plastkort, protokoller og ZK-bevis: Hva Digdirs JavaZone-foredrag betyr for Midnight-utviklere](https://sisit.no/innsikt/javazone-digdir-digital-lommebok-midnight.html) | EUDI |
| 2026-09-04 | [Mistillitsavgiften: Hvordan Compact, Midnight og MCP gjør advokaten til kvalitetssertifisør](https://sisit.no/innsikt/advokat-attestering-compact-mcp-midnight.html) | Compact contracts |
| 2026-09-05 | [Kommunistene er blitt de beste kapitalistene](https://sisit.no/innsikt/kommunistene-er-de-beste-kapitalistene.html) | Background |
| 2026-09-08 | [QR-koden som skal onboarde en milliard mennesker: Hva er Midnight Passport?](https://sisit.no/innsikt/midnight-passport.html) | Passport |
| 2026-09-10 | [Fra PlonK til lattice-kryptografi: Hva er egentlig Nightstream?](https://sisit.no/innsikt/nightstream.html) | Background |
| 2026-09-11 | [Loven ingen har lest ennå: Kan et lovforslag kodes før det vedtas?](https://sisit.no/innsikt/loven-ingen-har-lest-ennaa.html) | Background |
| 2026-09-17 | [SEC åpner for tokeniserte aksjer — hvorfor kravene ligner det Midnight allerede er bygget for](https://sisit.no/innsikt/sec-innovation-exemption-tokeniserte-aksjer.html) | Background |
| 2026-09-22 | [Cardano PRIME: Åtte hull i DeFi-økosystemet – hvem får betalt for å tette dem?](https://sisit.no/innsikt/cardano-prime-alphagrowth-midnight.html) | Background |
| 2026-09-24 | [MCP, Midnight og EUID: Slik bygges automatisk salg mellom AI-agenter](https://sisit.no/innsikt/mcp-midnight-euid-agentisk-salg.html) | Business wallet / EUID |
| 2026-09-26 | [Fra søknad til utbetaling: Hva støtteordningene for Cardano- og Midnight-utviklere faktisk krever](https://sisit.no/innsikt/stotteordninger-cardano-midnight-utviklere.html) | Background |
| 2026-10-02 | [Midnight åpner mainnet for alle utviklere: Hva permissionless deploy betyr for norske virksomheter](https://sisit.no/innsikt/midnight-permissionless-deploy-mainnet.html) | Platform |
| 2026-10-02 | [Medlemsjuks i trossamfunn: La medlemmet holde nøkkelen](https://sisit.no/innsikt/trossamfunn-medlemslister-digital-lommebok.html) | EUDI |
| 2026-10-03 | [Fra spekulasjon til innovasjon: Markedet priset inn Midnight-oppgraderingen før den kom](https://sisit.no/innsikt/midnight-markedet-priset-inn-oppgraderingen.html) | Background |
| 2026-10-04 | [Midnight på sosiale medier: mer aktivitet, men ikke dominans](https://sisit.no/innsikt/midnight-sosial-aktivitet.html) | Background |
| 2026-10-07 | [Halvparten av unge handler med KI: Slik kan lommebok, MCP og Midnight gi kunden kontrollen](https://sisit.no/innsikt/ki-netthandel-agent-midnight-eudi-mcp.html) | EUDI / agents |
| 2026-10-08 | [Ti ganger flere transaksjoner på ett døgn: Hva Cardanos travle uke betyr for utviklere](https://sisit.no/innsikt/cardano-tps-rekord-cip-0113-midnight.html) | CIP-0113 / KYC |
| 2026-10-10 | [Når agenten skal handle for deg: Hva Nightframe, EUDI-lommeboka og sandkassen har til felles](https://sisit.no/innsikt/nightframe-agenter-eudi-sandkasse.html) | EUDI / agents |
| 2026-10-13 | [La beviset følge brukeren: Kan lommeboken gjøre Nav raskere uten å flytte sakene?](https://sisit.no/innsikt/nav-statliggjoring-lommebok-midnight.html) | EUDI |
| 2026-10-14 | [Beviset for leveransen: Slik kan virksomhetslommebok og Midnight beskytte ærlige forsvarsleverandører](https://sisit.no/innsikt/nato-leveransebevis-virksomhetslommebok-midnight.html) | Business wallet |
| 2026-10-23 | [Midnight-veikartet for Q4 2026 og Q1 2027: Hva utviklere bør følge med på](https://sisit.no/innsikt/midnight-veikart-q4-2026-q1-2027.html) | Roadmap / Passport |
| 2026-10-23 | [PHP2Shell: Hva nyhetene om PHP betyr for virksomheten](https://sisit.no/innsikt/php2shell-artikkel.html) | Background |
| 2026-10-25 | [Kognitiv gjeld: hva dagens Midnight-verktøy kan bevise om kode](https://sisit.no/innsikt/kognitiv-gjeld-midnight-nyhet.html) | Background |
| 2026-10-27 | [Fem timer, flere profiler og ingen test ennå: veien til å levere én oppgave fra eget regnskapssystem](https://sisit.no/innsikt/offentlig-oppkobling-regnskapssystem.html) | Public data / accounting |
| 2026-10-31 | [The Binance hack: what do we know, and how could Cardano and Midnight limit attacks like it?](https://sisit.no/innsikt/binance-hack-cardano-midnight-en.html) | Proof of reserves |
| 2026-10-31 | [Binance-hacken: Hva vet vi, og hvordan kan Cardano og Midnight begrense slike angrep?](https://sisit.no/innsikt/binance-hacken-cardano-midnight.html) | Proof of reserves |
| 2026-11-04 | [Demokratene overtar Kongressen: Hva det betyr for norske utviklere](https://sisit.no/innsikt/demokratisk-kongress-norske-utviklere.html) | EUDI bridge / AMLR |
| 2026-11-05 | [Demokratenes første kryptoutspill: Mer SEC, etikkregler og hva det betyr for norske utviklere](https://sisit.no/innsikt/demokratisk-kryptoutspill-norske-utviklere.html) | PoR / MiCA |
| 2026-11-09 | [Midnight Ledger 9: kontrakter kan kalle hverandre, og ECDSA og Keccak er innebygd](https://sisit.no/innsikt/midnight-ledger-9-mainnet.html) | Toolchain / EUDI |
| 2026-11-16 | [Dyrere lagring på Ethereum: Hvordan Midnight flytter data ut av kjeden](https://sisit.no/innsikt/state-bloat-eip-8037-midnight.html) | Background |
| 2026-11-16 | [Costlier storage on Ethereum: how Midnight moves data off the chain](https://sisit.no/innsikt/state-bloat-eip-8037-midnight-en.html) | Background |
