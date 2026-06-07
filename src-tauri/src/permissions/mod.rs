use rusqlite::Connection;
use crate::error::{KomersaError, KomersaResult};

/// Toutes les permissions atomiques de l'application.
/// Chaque variante correspond à une action vérifiée par le cœur métier Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    // Ventes & caisse
    VoirVentes,
    CreerVente,
    AnnulerVente,
    OuvrirFermerCaisse,
    VenteACredit,
    // Marchandise
    VoirStock,
    GererProduits,
    AjusterStock,
    GererInventaire,
    // Finances
    VoirTresorerie,
    TransfertsTresorerie,
    PaiementFournisseur,
    GererDepenses,
    // Administration
    VoirRapports,
    GererUtilisateurs,
    ModifierParametres,
}

impl Permission {
    pub fn key(&self) -> &'static str {
        match self {
            Permission::VoirVentes => "voir_ventes",
            Permission::CreerVente => "creer_vente",
            Permission::AnnulerVente => "annuler_vente",
            Permission::OuvrirFermerCaisse => "ouvrir_fermer_caisse",
            Permission::VenteACredit => "vente_a_credit",
            Permission::VoirStock => "voir_stock",
            Permission::GererProduits => "gerer_produits",
            Permission::AjusterStock => "ajuster_stock",
            Permission::GererInventaire => "gerer_inventaire",
            Permission::VoirTresorerie => "voir_tresorerie",
            Permission::TransfertsTresorerie => "transferts_tresorerie",
            Permission::PaiementFournisseur => "paiement_fournisseur",
            Permission::GererDepenses => "gerer_depenses",
            Permission::VoirRapports => "voir_rapports",
            Permission::GererUtilisateurs => "gerer_utilisateurs",
            Permission::ModifierParametres => "modifier_parametres",
        }
    }
}

impl Permission {
    /// Libellé lisible (français) de la permission.
    pub fn label(&self) -> &'static str {
        match self {
            Permission::VoirVentes => "Voir les ventes",
            Permission::CreerVente => "Créer une vente",
            Permission::AnnulerVente => "Annuler une vente",
            Permission::OuvrirFermerCaisse => "Ouvrir / fermer la caisse",
            Permission::VenteACredit => "Vente à crédit",
            Permission::VoirStock => "Voir le stock",
            Permission::GererProduits => "Gérer les produits",
            Permission::AjusterStock => "Ajuster le stock",
            Permission::GererInventaire => "Gérer l'inventaire",
            Permission::VoirTresorerie => "Voir la trésorerie",
            Permission::TransfertsTresorerie => "Transferts de trésorerie",
            Permission::PaiementFournisseur => "Paiement fournisseur",
            Permission::GererDepenses => "Gérer les dépenses",
            Permission::VoirRapports => "Voir les rapports",
            Permission::GererUtilisateurs => "Gérer les utilisateurs",
            Permission::ModifierParametres => "Modifier les paramètres",
        }
    }

    /// Groupe d'appartenance (pour l'affichage).
    pub fn group(&self) -> &'static str {
        match self {
            Permission::VoirVentes | Permission::CreerVente | Permission::AnnulerVente
            | Permission::OuvrirFermerCaisse | Permission::VenteACredit => "Ventes & caisse",
            Permission::VoirStock | Permission::GererProduits | Permission::AjusterStock
            | Permission::GererInventaire => "Marchandise",
            Permission::VoirTresorerie | Permission::TransfertsTresorerie
            | Permission::PaiementFournisseur | Permission::GererDepenses => "Finances",
            Permission::VoirRapports | Permission::GererUtilisateurs
            | Permission::ModifierParametres => "Administration",
        }
    }
}

/// Toutes les permissions, dans l'ordre d'affichage.
pub const ALL_PERMISSIONS: [Permission; 16] = [
    Permission::VoirVentes, Permission::CreerVente, Permission::AnnulerVente,
    Permission::OuvrirFermerCaisse, Permission::VenteACredit,
    Permission::VoirStock, Permission::GererProduits, Permission::AjusterStock,
    Permission::GererInventaire,
    Permission::VoirTresorerie, Permission::TransfertsTresorerie,
    Permission::PaiementFournisseur, Permission::GererDepenses,
    Permission::VoirRapports, Permission::GererUtilisateurs, Permission::ModifierParametres,
];

/// Permission correspondant à une clé (ex. "transferts_tresorerie"), si elle existe.
pub fn from_key(key: &str) -> Option<Permission> {
    ALL_PERMISSIONS.into_iter().find(|p| p.key() == key)
}

/// Variante non-bloquante de `check` : retourne simplement true/false.
pub fn allowed(conn: &Connection, membership_id: &str, role: &str, perm: Permission) -> bool {
    check(conn, membership_id, role, perm).is_ok()
}

/// Autorise si AU MOINS UNE des permissions est accordée. Pour les écrans/lectures
/// accessibles à plusieurs rôles (ex. dettes fournisseurs : comptable OU acheteur).
pub fn check_any(
    conn: &Connection,
    membership_id: &str,
    role: &str,
    perms: &[Permission],
) -> KomersaResult<()> {
    if perms.iter().any(|p| allowed(conn, membership_id, role, *p)) {
        Ok(())
    } else {
        Err(KomersaError::PermissionDenied(
            "Accès refusé : permission insuffisante.".into(),
        ))
    }
}

/// Retourne true si le rôle accorde cette permission par défaut (modèle de rôle).
pub fn role_default(role: &str, perm: Permission) -> bool {
    match role {
        "Propriétaire" | "Administrateur" => true,
        "Responsable des ventes" => matches!(
            perm,
            Permission::VoirVentes
                | Permission::CreerVente
                | Permission::AnnulerVente
                | Permission::OuvrirFermerCaisse
                | Permission::VenteACredit
                | Permission::VoirStock
                | Permission::VoirRapports
        ),
        "Caissier" => matches!(
            perm,
            Permission::VoirVentes
                | Permission::CreerVente
                | Permission::OuvrirFermerCaisse
                | Permission::VenteACredit
        ),
        "Gestionnaire de stock" => matches!(
            perm,
            Permission::VoirStock
                | Permission::GererProduits
                | Permission::AjusterStock
                | Permission::GererInventaire
                | Permission::VoirRapports
        ),
        "Comptable" => matches!(
            perm,
            Permission::VoirTresorerie
                | Permission::TransfertsTresorerie
                | Permission::PaiementFournisseur
                | Permission::GererDepenses
                | Permission::VoirRapports
        ),
        "Vendeur" => matches!(perm, Permission::VoirVentes | Permission::CreerVente),
        _ => false,
    }
}

/// Vérifie si le membership a la permission — en tenant compte des overrides.
/// Priorité : override explicite (granted/denied) > modèle de rôle.
pub fn check(
    conn: &Connection,
    membership_id: &str,
    role: &str,
    perm: Permission,
) -> KomersaResult<()> {
    // 0. Revalider le statut du membership à chaque appel : un compte suspendu ou
    //    désactivé perd l'accès immédiatement, sans attendre une reconnexion.
    let mstatus: String = conn
        .query_row("SELECT mstatus FROM memberships WHERE id=?1", [membership_id], |r| r.get(0))
        .unwrap_or_else(|_| "Désactivé".to_string());
    if mstatus != "Actif" {
        return Err(KomersaError::PermissionDenied(format!(
            "Accès refusé — votre compte est {mstatus}."
        )));
    }

    // 1. Chercher un override explicite pour ce membership
    let override_result: Option<bool> = conn
        .query_row(
            "SELECT granted FROM membership_permissions
             WHERE membership_id = ?1 AND permission = ?2",
            [membership_id, perm.key()],
            |row| row.get::<_, i32>(0).map(|v| v != 0),
        )
        .ok();

    let allowed = match override_result {
        Some(granted) => granted,           // override explicite
        None => role_default(role, perm),   // fallback sur le modèle de rôle
    };

    if allowed {
        Ok(())
    } else {
        Err(KomersaError::PermissionDenied(format!(
            "Permission « {} » refusée pour le rôle « {} »",
            perm.key(),
            role
        )))
    }
}
