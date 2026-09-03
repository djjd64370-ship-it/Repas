// 👉 Pour afficher vos 10 prochains rendez-vous Google Calendar dans l'onglet Calendrier :
//
// 1. Rendez le calendrier public (ou au moins accessible) :
//    Google Calendar (web) > Paramètres de ce calendrier > "Autorisations d'accès"
//    > cochez "Rendre disponible publiquement".
//
// 2. Récupérez l'ID du calendrier :
//    Même page > section "Intégrer le calendrier" > copiez la valeur "ID du calendrier"
//    (souvent une adresse du type xxxxx@group.calendar.google.com, ou votre email
//    si c'est votre calendrier principal).
//
// 3. Créez une clé API Google :
//    console.cloud.google.com > sélectionnez le même projet que Firebase (ou un autre)
//    > API et services > Bibliothèque > cherchez "Google Calendar API" > Activer.
//    > API et services > Identifiants > Créer des identifiants > Clé API.
//    Restreignez-la ensuite à "Google Calendar API" pour la sécurité.
//
// 4. Collez les deux valeurs ci-dessous.

export const GOOGLE_CALENDAR_ID = "ccb2d8bfe92475664d309eb9825f71291a1c0beddf934c5cb20c05a03d1e7fb5@group.calendar.google.com";
export const GOOGLE_CALENDAR_API_KEY = "AQ.Ab8RN6IpyLwAzqWIT935GnpzeJ_mJgZj8tVXl7uiBlOO7cDO-w";
