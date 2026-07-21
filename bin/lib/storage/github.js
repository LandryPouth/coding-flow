"use strict";

// Backend de stockage "github" : epics <-> issues, stories <-> sub-issues.
//
// SEAM EN PLACE, IMPLEMENTATION DIFFEREE. Le mapping se ferait via `gh api
// graphql` (les sub-issues n'ont pas encore de commande first-class dans `gh`),
// ce qui ferait passer `gh` de dependance optionnelle a dure et ajouterait un
// acces reseau a chaque lecture d'epic/story. On ne paie ce cout que si un vrai
// utilisateur le reclame — voir docs/plans/storage-backends.md.
//
// D'ici la, choisir ce backend echoue proprement (message clair) plutot que de
// planter : le seam est prouve, la porte est ouverte, rien n'est casse.

const { fail } = require("../util");

function createGithubStorage() {
  const notImplemented = () =>
    fail(
      "le backend de stockage 'github' n'est pas encore implemente. " +
        "Seul 'local' est disponible pour l'instant (voir docs/plans/storage-backends.md).",
    );

  return {
    kind: "github",
    listEpics: notImplemented,
  };
}

module.exports = { createGithubStorage };
