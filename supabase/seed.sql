-- Données initiales du Cockpit IA (réunion Direction du 21/10/2026)
-- Généré depuis cockpit_ia_sapaudia_couleurs.html. Idempotent : n'écrase rien d'existant.

insert into public.subjects (id, name, category, status, summary, confirmed, hypothesis, questions, people, next_step, due_date, origin, color, notes, position) values
  ('strategy', 'Positionnement Sapaudia — opérateur IA', 'Sujet stratégique', 'À cadrer', 'Ambition de proposer des solutions IA aux entreprises ; modèle cité : Limova. Périmètre au-delà des agents IA possible.', 'Le positionnement comme opérateur IA a été évoqué. Limova est un modèle de référence mentionné.', 'L’offre pourrait combiner agents IA, conseil, intégration et accompagnement.', 'Définir précisément le périmètre de l’offre et le modèle économique.', 'Président ; Fred', 'Clarifier la vision et analyser les modèles concurrents.', null, 'Réunion Direction — 21/10/2026', '#8b5cf6', '', 0),
  ('moon', 'Moon by DFM — agent data room', 'Projet IA', 'En cours', 'Agent d’analyse de data room, avec complément envisagé pour examiner le site de l’entreprise et ses concurrents.', 'Démarrage indiqué le 6 octobre 2026 ; durée annoncée de six semaines. Référent : Arthur Bayon, actuellement absent ; relais : Dominique Bayon. Trois pièces évoquées : proposition commerciale, document de maintenance (intitulé incertain), bon de commande. Complément d’analyse externe demandé.', 'Livraison théorique vers le 17 novembre, sous réserve du point de départ contractuel et du complément.', 'Date contractuelle de livraison ; portée et coût du complément ; contenu exact des documents et de la note process ; utilisateurs ; validation.', 'Arthur Bayon ; Dominique Bayon ; Fred', 'Récupérer les documents et la note de processus.', '2026-11-17', 'Réunion Direction — 21/10/2026', '#2563eb', '', 1),
  ('training', 'Formation IA et visite en petit comité', 'Formation / rendez-vous', 'À faire', 'Formation interne le 10 novembre (intervenant peut-être Moon), avec cas d’usage ; visite le 2 décembre avec un groupe plus restreint.', 'Dates citées : 10 novembre et 2 décembre 2026.', 'La visite pourrait approfondir la formation, sans certitude.', 'Intervenant, entreprise visitée, programme, participants et objectifs.', 'À clarifier', 'Confirmer organisation et programmes.', '2026-11-10', 'Réunion Direction — 21/10/2026', '#0d9488', '', 2),
  ('edison', 'Benchmark Edison IA', 'Benchmark', 'À faire', 'Analyser Edison IA : offres, clients, prix, fonctionnalités, démarche commerciale et pertinence pour Sapaudia.', 'Analyse demandée avec une restitution au plus tard début décembre 2026.', 'L’étude pourra éclairer le futur positionnement commercial de Sapaudia.', 'Périmètre exact, format attendu et disponibilité d’exemples précédents.', 'Pierrick Nijki (orthographe à vérifier) ; Fred', 'Demander un exemple d’analyse à Pierrick puis lancer le benchmark.', '2026-12-01', 'Réunion Direction — 21/10/2026', '#ea580c', '', 3),
  ('lumina', 'Analyse Lumina.ai', 'Benchmark potentiel', 'À cadrer', 'Entreprise citée comme modèle particulièrement inspirant par le Président.', 'Lumina.ai a été évoquée favorablement par le Président.', 'Un benchmark complémentaire pourrait être pertinent.', 'Vérifier l’identité et le domaine exacts de l’entreprise. Confirmer si un benchmark est demandé.', 'Président ; Fred', 'Valider l’entreprise ciblée et la demande.', null, 'Réunion Direction — 21/10/2026', '#db2777', '', 4),
  ('governance', 'Pilotage mensuel et comptes rendus IA', 'Pilotage', 'À faire', 'Réunion d’avancement le premier lundi de chaque mois à 16 h, sauf semaine de cours. Échange avec Fred sur les comptes rendus générés.', 'Cadence proposée : premier lundi à 16 h ; échange avec Fred demandé le 22 octobre.', 'Les réunions devront peut-être être décalées durant les semaines de cours.', 'Participants, décalage ou annulation en semaine de cours, qualité attendue des comptes rendus.', 'Fred ; participants à confirmer', 'Voir Fred et confronter les dates au calendrier d’alternance.', '2026-10-22', 'Réunion Direction — 21/10/2026', '#64748b', '', 5),
  ('guillaume', 'Rencontre Guillaume — Koredge', 'Prise de contact', 'À faire', 'Prise de contact envisagée avec Guillaume, qui s’occupe de l’informatique chez Koredge.', 'Guillaume est présenté comme interlocuteur informatique Koredge.', 'Il pourrait contribuer à la faisabilité technique des projets.', 'Fonction exacte, coordonnées, date du rendez-vous.', 'Guillaume', 'Organiser une première rencontre.', null, 'Réunion Direction — 21/10/2026', '#0891b2', '', 6),
  ('king', 'Client « King Vert » — suivi production', 'Action opérationnelle', 'À cadrer', 'Participation possible au suivi de production d’un client dont le nom entendu serait King Vert.', 'Sujet de suivi client mentionné pendant la réunion.', 'Ton rôle pourrait relever du suivi de production.', 'Nom exact du client ; périmètre ; responsables ; prochaines étapes.', 'À clarifier', 'Vérifier le client et la mission.', null, 'Réunion Direction — 21/10/2026', '#65a30d', '', 7),
  ('besancon', 'Commerciaux — Besançon', 'Sujet existant', 'En attente', 'Dossier déjà connu, à reprendre plus tard sans y revenir pour le moment.', 'Consigne de ne pas repasser sur ce sujet maintenant.', '', 'Contexte et date de reprise non fournis.', 'À clarifier', 'Attendre sa remise à l’ordre du jour.', null, 'Réunion Direction — 21/10/2026', '#a16207', '', 8)
on conflict (id) do nothing;

insert into public.tasks (id, name, subject_id, status, priority, owner, due_date, position) values
  ('t1', 'Voir Fred sur les comptes rendus IA générés', 'governance', 'À faire', 'P1', 'Fred', '2026-10-22', 0),
  ('t2', 'Récupérer propal, maintenance et bon de commande Moon', 'moon', 'À faire', 'P1', 'Fred / Dominique (à confirmer)', null, 1),
  ('t3', 'Demander la note du process d’analyse Moon', 'moon', 'À faire', 'P1', 'Arthur / Dominique', null, 2),
  ('t4', 'Contacter Pierrick pour un exemple d’analyse', 'edison', 'À faire', 'P1', 'Pierrick Nijki', null, 3),
  ('t5', 'Réaliser le benchmark Edison IA', 'edison', 'À faire', 'P1', 'À clarifier', '2026-12-01', 4),
  ('t6', 'Confirmer formation du 10 novembre et visite du 2 décembre', 'training', 'À faire', 'P2', 'Fred / organisateur', '2026-11-10', 5),
  ('t7', 'Organiser les points mensuels selon semaines de cours', 'governance', 'À faire', 'P2', 'À clarifier', null, 6),
  ('t8', 'Vérifier Lumina et arbitrer le benchmark', 'lumina', 'À faire', 'P2', 'Président / Fred', null, 7),
  ('t9', 'Organiser une rencontre avec Guillaume', 'guillaume', 'À faire', 'P2', 'Guillaume', null, 8),
  ('t10', 'Clarifier le suivi client King Vert', 'king', 'À faire', 'P2', 'Fred / responsable client', null, 9),
  ('t11', 'Clarifier la note « reco GPO »', 'moon', 'À faire', 'P3', 'Fred / Dominique', null, 10),
  ('t12', 'Conserver Besançon pour reprise ultérieure', 'besancon', 'En attente', 'P3', 'À clarifier', null, 11)
on conflict (id) do nothing;

insert into public.events (id, date, name, subject_id, kind) values
  ('e1', '2026-10-22', 'Échange Fred — comptes rendus IA', 'governance', 'Action'),
  ('e2', '2026-11-02', 'Avancement IA — sous réserve cours', 'governance', 'Récurrence théorique'),
  ('e3', '2026-11-10', 'Formation IA en entreprise', 'training', 'Événement'),
  ('e4', '2026-11-17', 'Moon — livraison théorique', 'moon', 'Hypothèse'),
  ('e5', '2026-12-01', 'Benchmark Edison — échéance indicative', 'edison', 'Échéance'),
  ('e6', '2026-12-02', 'Visite en petit comité', 'training', 'Événement'),
  ('e7', '2026-12-07', 'Avancement IA — sous réserve cours', 'governance', 'Récurrence théorique'),
  ('e8', '2027-01-04', 'Avancement IA — sous réserve cours', 'governance', 'Récurrence théorique')
on conflict (id) do nothing;
