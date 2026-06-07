#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod error;
mod models;
mod permissions;
mod session;

use db::Database;
use session::SessionState;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialiser la base SQLite dans le répertoire de données de l'app.
            let app_data = app
                .path_resolver()
                .app_data_dir()
                .expect("Impossible d'accéder au répertoire de données de l'application.");

            std::fs::create_dir_all(&app_data)
                .expect("Impossible de créer le répertoire de données.");

            // Restauration en attente : on remplace la base AVANT de l'ouvrir
            // (fichier fermé = remplacement sûr). Déposée par restore_database.
            let pending = app_data.join("komersa.db.restore-pending");
            if pending.exists() {
                let _ = std::fs::remove_file(app_data.join("komersa.db"));
                let _ = std::fs::remove_file(app_data.join("komersa.db-wal"));
                let _ = std::fs::remove_file(app_data.join("komersa.db-shm"));
                let _ = std::fs::rename(&pending, app_data.join("komersa.db"));
            }

            let db_path = app_data.join("komersa.db");
            let database = Database::open(&db_path)
                .expect("Impossible d'initialiser la base de données.");

            app.manage(database);
            app.manage(SessionState::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Setup wizard
            commands::setup::get_setup_status,
            commands::setup::create_commerce,
            commands::setup::create_admin_account,
            // Authentification
            commands::auth::login,
            commands::auth::login_pin,
            commands::auth::login_account,
            commands::auth::list_login_accounts,
            commands::auth::list_my_permissions,
            commands::auth::logout,
            commands::auth::get_session,
            commands::auth::has_permission,
            // Catalogue
            commands::catalog::get_stock_metrics,
            commands::catalog::list_products,
            commands::catalog::create_product,
            commands::catalog::update_product,
            commands::catalog::delete_product,
            commands::catalog::adjust_stock,
            commands::catalog::list_categories,
            commands::catalog::list_suppliers,
            commands::catalog::list_suppliers_full,
            commands::catalog::create_supplier,
            commands::catalog::update_supplier,
            // Ventes & POS
            commands::sales::list_payment_modes,
            commands::sales::list_clients,
            commands::sales::create_sale,
            commands::sales::list_sales,
            commands::sales::get_sales_metrics,
            commands::sales::get_sale_detail,
            commands::sales::cancel_sale,
            commands::sales::create_sale_return,
            // Caisse
            commands::cash::get_open_cash_session,
            commands::cash::open_cash_session,
            commands::cash::add_cash_movement,
            commands::cash::list_cash_movements,
            commands::cash::close_cash_session,
            commands::cash::list_cash_sessions,
            // Trésorerie
            commands::treasury::get_treasury_summary,
            commands::treasury::list_treasury_accounts,
            commands::treasury::create_treasury_account,
            commands::treasury::update_treasury_account,
            commands::treasury::toggle_as_payment,
            commands::treasury::toggle_account_active,
            commands::treasury::delete_treasury_account,
            commands::treasury::create_transfer,
            commands::treasury::list_transfers,
            commands::treasury::list_account_movements,
            commands::treasury::list_pending_handovers,
            commands::treasury::validate_handover,
            // Clients & Crédits
            commands::clients::list_clients_full,
            commands::clients::create_client,
            commands::clients::update_client,
            commands::clients::list_customer_credits,
            commands::clients::get_credit_metrics,
            commands::clients::list_credit_payments,
            commands::clients::add_credit_payment,
            // Achats & Dettes
            commands::purchases::list_purchases,
            commands::purchases::get_purchase_metrics,
            commands::purchases::get_debt_metrics,
            commands::purchases::get_purchase_detail,
            commands::purchases::create_purchase,
            commands::purchases::receive_purchase,
            commands::purchases::list_supplier_debts,
            commands::purchases::add_debt_payment,
            // Dépenses
            commands::expenses::get_expense_metrics,
            commands::expenses::list_expenses,
            commands::expenses::list_expense_categories,
            commands::expenses::create_expense,
            commands::expenses::update_expense_status,
            commands::expenses::delete_expense,
            // Pièces jointes génériques (justificatifs)
            commands::attachments::list_attachments,
            commands::attachments::add_attachment,
            commands::attachments::delete_attachment,
            // Inventaire
            commands::inventory::list_inventory_sessions,
            commands::inventory::create_inventory_session,
            commands::inventory::list_inventory_counts,
            commands::inventory::save_inventory_count,
            commands::inventory::close_inventory_session,
            // Rapports & Tableau de bord
            commands::reports::get_dashboard_snapshot,
            commands::reports::get_report,
            // Alertes
            commands::alerts::generate_alerts,
            commands::alerts::list_alerts,
            commands::alerts::get_alert_metrics,
            commands::alerts::update_alert_status,
            commands::alerts::list_alert_rules,
            commands::alerts::create_alert_rule,
            commands::alerts::update_alert_rule,
            commands::alerts::delete_alert_rule,
            // Paramètres
            commands::settings::get_commerce_info,
            commands::settings::update_commerce_info,
            commands::settings::get_settings,
            commands::settings::set_setting,
            // Administration — Membres
            commands::admin::list_members,
            commands::admin::create_member,
            commands::admin::update_member_status,
            commands::admin::update_member_role,
            commands::admin::get_member_permissions,
            commands::admin::set_member_permission,
            commands::admin::reset_member_pin,
            commands::admin::get_member_activity,
            // Administration — Postes
            commands::admin::list_postes,
            commands::admin::create_poste,
            commands::admin::update_poste,
            commands::admin::delete_poste,
            // Administration — Licence
            commands::admin::get_license,
            // Photos
            commands::photos::set_photo,
            commands::photos::get_photo,
            commands::photos::delete_photo,
            // Sauvegarde / restauration locale
            commands::backup::get_database_info,
            commands::backup::backup_database,
            commands::backup::restore_database,
            // Journal d'audit
            commands::audit::list_audit_log,
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au démarrage de l'application.");
}
