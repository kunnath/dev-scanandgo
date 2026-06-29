// Translation dictionary and utility functions for ScanAndGo
(function() {
  const translations = {
    en: {
      // profile page
      "profile_title": "Profile",
      "profile_logout": "Logout",
      "profile_hide_phone": "Hide phone from conductor",
      "profile_hide_pass": "Hide Poyaloo Pass card",
      "profile_block_pass": "Block Poyaloo Pass card",
      "profile_view_pass": "View Pass",
      "profile_poyaloo_pass": "Poyaloo Pass",
      "profile_kerala_traveler": "Kerala Traveler",
      "profile_smart_card_desc": "Scan QR code or use the 11-digit card number to board.",
      "profile_download_digital_pass": "Download Digital Pass",
      "profile_physical_card_delivery": "Physical Card Delivery",
      "profile_physical_card_status": "First card is FREE! Subsequent cards cost ₹40.",
      "profile_house_placeholder": "House Name / Street Address",
      "profile_city_placeholder": "Post Office / City",
      "profile_zip_placeholder": "Zipcode",
      "profile_phone_placeholder": "Contact Phone",
      "profile_send_physical_btn": "Send Physical Card",
      "profile_wallet_balance": "Wallet Balance",
      "profile_add_money": "Add Money",
      "profile_upi_earnings": "UPI & Earnings",
      "profile_today": "Today",
      "profile_total": "Total",
      "profile_upi_id": "UPI ID",
      "profile_manage_upi": "Manage UPI Settings →",
      "profile_current_assignment": "Current Assignment",
      "profile_route": "Route",
      "profile_bus": "Bus",
      "profile_update_assignment": "Update Assignment",
      "profile_owner_subscription": "Owner Subscription",
      "profile_status": "Status",
      "profile_expires_on": "Expires On",
      "profile_renew_plan": "Renew Plan",
      "profile_pay_using": "Pay Using",
      "profile_invoice_expense": "Invoice & Expense",
      "profile_invoice_expense_desc": "Submit shift invoices (fuel, tolls, maintenance) or miscellaneous expenses.",
      "profile_entry_type": "Entry Type",
      "profile_invoice_opt": "Invoice (fuel, tolls, maintenance)",
      "profile_misc_opt": "Miscellaneous Expense",
      "profile_amount_label": "Amount (₹)",
      "profile_details_label": "Details",
      "profile_details_placeholder": "E.g. Diesel refill 30L at Highway Pump",
      "profile_proof_label": "Proof of Bill (optional · PNG, JPG, PDF · max 5 MB)",
      "profile_submit_entry": "Submit Entry",
      
      // nav
      "nav_track": "Track",
      "nav_routes": "Routes",
      "nav_book": "Book",
      "nav_wallet": "Wallet",
      "nav_tickets": "Tickets",
      "nav_dashboard": "Dashboard",
      "nav_admin": "Admin",
      "nav_scan": "Scan",

      // auth screen
      "auth_brand_title": "Poyaloo ScanAndGo",
      "auth_brand_desc": "Track buses. Buy tickets. Scan & board.",
      "auth_login": "Login",
      "auth_register": "Register",
      "auth_username_label": "Username / Phone",
      "auth_username_placeholder": "Enter username or phone number",
      "auth_password_label": "Password",
      "auth_password_placeholder": "Enter password",
      "auth_forgot_password": "Forgot Password?",
      "auth_reset_title": "Reset Password",
      "auth_reset_desc": "Enter your registered email address. We'll send you a link to reset your password.",
      "auth_email_label": "Email Address",
      "auth_email_placeholder": "Enter your registered email",
      "auth_send_reset_btn": "Send Reset Link",
      "auth_cancel_btn": "Cancel",
      "auth_fullname_label": "Full Name",
      "auth_fullname_placeholder": "Enter your name",
      "auth_phone_label": "Phone Number",
      "auth_phone_placeholder": "Enter phone number",
      "auth_email_optional_label": "Email (optional)",
      "auth_email_optional_placeholder": "Enter email",
      "auth_create_password_label": "Password",
      "auth_create_password_placeholder": "Create password",
      "auth_role_label": "Role",
      "auth_role_passenger": "Passenger",
      "auth_role_conductor": "Conductor",
      "auth_role_owner": "Owner",
      "auth_create_account_btn": "Create Account",
      "reg_ticket_category": "Ticket Category",
      "reg_cat_adult": "🎫 Adult",
      "reg_cat_student": "🎓 Student",
      "reg_cat_free": "🆓 Free",
      "reg_pass_document": "Pass Document",
      "reg_owner_plan": "Owner Subscription Plan",
      "reg_select_plan_placeholder": "-- Select Plan --",
      "plan_monthly": "Monthly",
      "plan_yearly": "Yearly",
      "reg_select_zone": "Select Zone",
      "reg_choose_zone_placeholder": "-- Choose Zone --",
      "reg_assigned_route": "Assigned Route",
      "reg_select_zone_first": "-- Select Zone First --",
      "reg_bus_number": "Bus Number",
      "reg_upi_label": "💳 Your UPI ID (to receive ticket payments)",

      // map page
      "map_track_buses": "Track Buses",
      "map_select_route_to_track": "Select Route to track",
      "map_all_routes": "All Routes",
      "map_search_placeholder": "Search for bus stops...",
      "tab_track_route": "Track Route",
      "tab_map_view": "MAP View",
      "trip_origin_label": "Origin From",
      "trip_origin_placeholder": "Origin From",
      "trip_destination_label": "Destination To",
      "trip_destination_placeholder": "Destination To",
      
      // routes page
      "routes_title": "Routes & Schedules",
      "routes_search_placeholder": "Search routes (e.g. Kannur, Thalassery)...",
      
      // booking page
      "book_title": "Book ticket",
      "book_balance": "Balance:",
      "book_from": "From",
      "book_select_source": "-- Select Source --",
      "book_to": "To",
      "book_select_dest": "-- Select Destination --",
      "book_select_bus": "Select Bus",
      "book_no_buses": "No buses active on this route",
      "book_bus_fare": "Bus Fare:",
      "book_passengers": "Passengers",
      "book_student_pass": "🎓 Poyaloo Student Pass active! (Free travel)",
      "book_regular_pass": "🎟️ Poyaloo Pass active! (Free travel)",
      "book_pay_using": "Pay using:",
      "book_pay_wallet": "Wallet",
      "book_pay_upi": "UPI / Card",
      "book_pay_cash": "Cash to Conductor",
      "book_pay_now": "Pay Now & Book",
      "book_price_per_ticket": "Price per ticket",
      "book_total_amount": "Total Amount",

      // wallet page
      "wallet_title": "My Wallet",
      "wallet_available_bal": "Available Balance",
      "wallet_enter_amount": "Enter amount to add (₹)",
      "wallet_pay_with": "Pay with:",
      "wallet_quick_add": "Quick Add:",
      "wallet_add_money_btn": "Add Money to Wallet",
      "wallet_transaction_history": "Transaction History",
      "wallet_no_transactions": "No transactions yet.",
      "wallet_card_label": "ScanAndGo Wallet",
      "wallet_quick_add_title": "Quick Add",
      "wallet_enter_amount_placeholder": "Enter amount",
      "wallet_pay_using": "Pay using",
      "wallet_add_money": "Add Money",
      "wallet_secure_note": "🔐 Secured by Razorpay · 256-bit encrypted",
      "wallet_recharge_desc": "Enter the 11-digit card number shown on the physical or digital Poyaloo bus pass to recharge card balance and wallet.",
      "wallet_card_num_label": "11-Digit Card Number",
      "wallet_card_num_placeholder": "e.g. 50991234567",
      "wallet_recharge_amount_placeholder": "Enter recharge amount",
      "wallet_pay_using_colon": "Pay using:",
      "wallet_recent_txns": "Recent Transactions",
      "profile_hide_btn": "Hide",
      "book_info_desc": "Select route, stops, and bus to see fare calculation",
      "book_choose_route": "Choose a route",
      "book_from_stop_label": "From Stop",
      "book_to_stop_label": "To Stop",
      "book_ticket_count_label": "Number of Tickets",
      "book_pay_poyaloo_card_label": "Pay using Poyaloo Pass Card Number (Optional)",
      "book_pay_poyaloo_card_placeholder": "e.g. 50991234567",
      "book_scan_qr_btn": "Scan QR",
      "book_wallet_balance_hint": "Leave blank to pay with your own wallet balance.",

      // tickets page
      "tickets_title": "My Tickets",
      "tickets_active_tab": "Active",
      "tickets_history_tab": "History",
      "tickets_no_tickets": "No tickets found.",

      // scanner page
      "scanner_title": "Conductor Dashboard",
      "scanner_recent_settlements": "Recent Settlements",
      "scanner_no_settlements": "No settlements yet. Validate tickets to earn.",
      "scanner_scan_button": "Scan Ticket QR",
      "scanner_manual_label": "Or Enter 11-digit Poyaloo Pass Card Number / Ticket ID",
      "scanner_validate_btn": "Validate Card / Ticket",
      "profile_refresh": "Refresh",
      "scanner_save_upi": "Save UPI Details",
      "scanner_upi_settings_title": "💳 UPI Payment Settings",
      "recharge_pass_title": "Recharge Poyaloo Pass / Wallet",
      "recharge_card_btn": "Recharge Card & Wallet",
      "scanner_scan_tab": "Scan Ticket",
      "scanner_validated_tab": "Validated",
      "scanner_upi_tab": "UPI",
      "scanner_voice_on": "Voice On",
      "scanner_open_camera": "Open Camera & Scan",
      "scanner_stop_camera": "Stop Camera",
      "scanner_take_photo": "Take Photo of QR",
      "scanner_from_gallery": "From Gallery",
      "scanner_paste_manual": "Or paste QR data manually",
      "scanner_paste_placeholder": "Paste QR code data here...",
      "scanner_validate_manual": "Validate Manually",

      // pass modal/UI
      "pass_buy_pass_btn": "Buy Poyaloo Pass (₹150)",
      "pass_buy_using": "Pay ₹150 using:",
      "pass_buy_promo": "Purchase a Poyaloo Bus Pass remotely to travel digitally or physically. Top-up using card number anywhere.",
      "pass_smart_card": "Poyaloo Pass",
      "pass_smart_card_sub": "Kerala Traveler",
      "pass_smart_card_active": "● Active",
      "pass_smart_card_number": "Card: ---- ---- ---",
      "pass_smart_card_balance": "Balance:",
      "owner_assign_title": "Assign Bus",
      "owner_assign_conductor_label": "Conductor (Name or Mobile)",
      "owner_assign_btn": "Assign",
      "select_bus_placeholder": "Select Bus",
      "select_route_placeholder": "Select Route",
      "select_conductor_placeholder": "Select Conductor",
      "owner_buses_conductors_title": "Your Buses & Conductors",
      "profile_group_chat": "Group Chat",
      "profile_community_chat": "Community Chat",
      "chat_general": "General",
      "chat_movies": "Movies",
      "chat_dating": "Dating",
      "chat_politics": "Politics",
      "owner_sub_pay_btn": "Pay Subscription",
      "sub_status_active": "ACTIVE",
      "sub_status_inactive": "INACTIVE",
      "plan_thirty_days_used": "30 Days (one-time only — already used)",
      "plan_thirty_days": "30 Days",
      "select_bus_number": "Select Bus Number",
      "select_route": "Select Route",
      "select_conductor": "Select Conductor",
      "available_conductors": "✓ Available Conductors",
      "currently_assigned": "⚠️ Currently Assigned",
      "assigned": "ASSIGNED",
      "not_assigned": "Not assigned",
      "processing": "Processing..."
    },
    ml: {
      // profile page
      "profile_title": "പ്രൊഫൈൽ",
      "profile_logout": "ലോഗ് ഔട്ട്",
      "profile_hide_phone": "കണ്ടക്ടറിൽ നിന്ന് ഫോൺ നമ്പർ മറയ്ക്കുക",
      "profile_hide_pass": "പോയലൂ പാസ് കാർഡ് മറയ്ക്കുക",
      "profile_block_pass": "പോയലൂ പാസ് കാർഡ് ബ്ലോക്ക് ചെയ്യുക",
      "profile_view_pass": "പാസ് കാണുക",
      "profile_poyaloo_pass": "പോയലൂ പാസ്",
      "profile_kerala_traveler": "കേരള ട്രാവലർ",
      "profile_smart_card_desc": "ബോർഡിംഗിനായി QR കോഡ് സ്കാൻ ചെയ്യുക അല്ലെങ്കിൽ 11 അക്ക കാർഡ് നമ്പർ ഉപയോഗിക്കുക.",
      "profile_download_digital_pass": "ഡിജിറ്റൽ പാസ് ഡൗൺലോഡ് ചെയ്യുക",
      "profile_physical_card_delivery": "ഫിസിക്കൽ കാർഡ് വിതരണം",
      "profile_physical_card_status": "ആദ്യ കാർഡ് സൌജന്യമാണ്! തുടർന്നുള്ള കാർഡുകൾക്ക് ₹40 രൂപയാണ്.",
      "profile_house_placeholder": "വീട്ടുപേര് / തെരുവ് വിലാസം",
      "profile_city_placeholder": "പോസ്റ്റ് ഓഫീസ് / നഗരം",
      "profile_zip_placeholder": "പിൻകോഡ്",
      "profile_phone_placeholder": "ബന്ധപ്പെടേണ്ട ഫോൺ നമ്പർ",
      "profile_send_physical_btn": "ഫിസിക്കൽ കാർഡ് അയയ്ക്കുക",
      "profile_wallet_balance": "വാലറ്റ് ബാലൻസ്",
      "profile_add_money": "പണം ചേർക്കുക",
      "profile_upi_earnings": "UPI & വരുമാനം",
      "profile_today": "ഇന്ന്",
      "profile_total": "ആകെ",
      "profile_upi_id": "UPI ഐഡി",
      "profile_manage_upi": "UPI ക്രമീകരണങ്ങൾ നിയന്ത്രിക്കുക →",
      "profile_current_assignment": "നിലവിലെ ഡ്യൂട്ടി",
      "profile_route": "റൂട്ട്",
      "profile_bus": "ബസ്",
      "profile_update_assignment": "ഡ്യൂട്ടി അപ്ഡേറ്റ് ചെയ്യുക",
      "profile_owner_subscription": "ഓണർ സബ്‌സ്‌ക്രിപ്ഷൻ",
      "profile_status": "സ്റ്റാറ്റസ്",
      "profile_expires_on": "കാലാവധി കഴിയുന്നത്",
      "profile_renew_plan": "പ്ലാൻ പുതുക്കുക",
      "profile_pay_using": "പണമടയ്ക്കാൻ",
      "profile_invoice_expense": "ഇൻവോയ്‌സും ചിലവും",
      "profile_invoice_expense_desc": "ഷിഫ്റ്റ് ഇൻവോയ്‌സുകളോ (ഇന്ധനം, ടോൾ, അറ്റകുറ്റപ്പണികൾ) അല്ലെങ്കിൽ മറ്റ് ചിലവുകളോ സമർപ്പിക്കുക.",
      "profile_entry_type": "എൻട്രി ടൈപ്പ്",
      "profile_invoice_opt": "ഇൻവോയ്‌സ് (ഇന്ധനം, ടോൾ, അറ്റകുറ്റപ്പണി)",
      "profile_misc_opt": "മറ്റ് ചിലവുകൾ",
      "profile_amount_label": "തുക (₹)",
      "profile_details_label": "വിശദാംശങ്ങൾ",
      "profile_details_placeholder": "ഉദാ: ഹൈവേ പമ്പിൽ നിന്നും 30L ഡീസൽ അടിച്ചു",
      "profile_proof_label": "ബില്ലിന്റെ തെളിവ് (ഓപ്ഷണൽ · PNG, JPG, PDF · പരമാവധി 5 MB)",
      "profile_submit_entry": "സമർപ്പിക്കുക",

      // nav
      "nav_track": "ട്രാക്ക്",
      "nav_routes": "റൂട്ടുകൾ",
      "nav_book": "ബുക്ക്",
      "nav_wallet": "വാലറ്റ്",
      "nav_tickets": "ടിക്കറ്റുകൾ",
      "nav_dashboard": "ഡാഷ്‌ബോർഡ്",
      "nav_admin": "അഡ്മിൻ",
      "nav_scan": "സ്കാൻ",

      // auth screen
      "auth_brand_title": "പോയലൂ സ്കാൻ ആൻഡ് ഗോ",
      "auth_brand_desc": "ബസുകൾ ട്രാക്ക് ചെയ്യാം. ടിക്കറ്റുകൾ വാങ്ങാം. സ്കാൻ ചെയ്ത് യാത്ര ചെയ്യാം.",
      "auth_login": "ലോഗിൻ",
      "auth_register": "രജിസ്റ്റർ",
      "auth_username_label": "യൂസർ നെയിം / ഫോൺ",
      "auth_username_placeholder": "യൂസർ നെയിം അല്ലെങ്കിൽ ഫോൺ നമ്പർ നൽകുക",
      "auth_password_label": "പാസ്‌വേഡ്",
      "auth_password_placeholder": "പാസ്‌വേഡ് നൽകുക",
      "auth_forgot_password": "പാസ്‌വേഡ് മറന്നുപോയോ?",
      "auth_reset_title": "പാസ്‌വേഡ് റീസെറ്റ് ചെയ്യുക",
      "auth_reset_desc": "രജിസ്റ്റർ ചെയ്ത ഇമെയിൽ വിലാസം നൽകുക. റീസെറ്റ് ചെയ്യാനുള്ള ലിങ്ക് ഞങ്ങൾ അയച്ചുതരാം.",
      "auth_email_label": "ഇമെയിൽ വിലാസം",
      "auth_email_placeholder": "രജിസ്റ്റർ ചെയ്ത ഇമെയിൽ നൽകുക",
      "auth_send_reset_btn": "റീസെറ്റ് ലിങ്ക് അയയ്ക്കുക",
      "auth_cancel_btn": "റദ്ദാക്കുക",
      "auth_fullname_label": "പൂർണ്ണമായ പേര്",
      "auth_fullname_placeholder": "നിങ്ങളുടെ പേര് നൽകുക",
      "auth_phone_label": "ഫോൺ നമ്പർ",
      "auth_phone_placeholder": "ഫോൺ നമ്പർ നൽകുക",
      "auth_email_optional_label": "ഇമെയിൽ (ഓപ്ഷണൽ)",
      "auth_email_optional_placeholder": "ഇമെയിൽ നൽകുക",
      "auth_create_password_label": "പാസ്‌വേഡ്",
      "auth_create_password_placeholder": "പാസ്‌വേഡ് നിർമ്മിക്കുക",
      "auth_role_label": "റോൾ (പദവി)",
      "auth_role_passenger": "യാത്രക്കാരൻ",
      "auth_role_conductor": "കണ്ടക്ടർ",
      "auth_role_owner": "ബസ് ഉടമ",
      "auth_create_account_btn": "അക്കൗണ്ട് നിർമ്മിക്കുക",
      "reg_ticket_category": "ടിക്കറ്റ് വിഭാഗം",
      "reg_cat_adult": "🎫 മുതിർന്നവർ (Adult)",
      "reg_cat_student": "🎓 വിദ്യാർത്ഥി (Student)",
      "reg_cat_free": "🆓 സൗജന്യം (Free)",
      "reg_pass_document": "പാസ് രേഖകൾ (Pass Document)",
      "reg_owner_plan": "ബസ് ഉടമ സബ്‌സ്‌ക്രിപ്ഷൻ പ്ലാൻ",
      "reg_select_plan_placeholder": "-- പ്ലാൻ തിരഞ്ഞെടുക്കുക --",
      "plan_monthly": "പ്രതിമാസം (Monthly)",
      "plan_yearly": "പ്രതിവർഷം (Yearly)",
      "reg_select_zone": "മേഖല തിരഞ്ഞെടുക്കുക (Zone)",
      "reg_choose_zone_placeholder": "-- മേഖല തിരഞ്ഞെടുക്കുക --",
      "reg_assigned_route": "അസൈൻ ചെയ്ത റൂട്ട്",
      "reg_select_zone_first": "-- ആദ്യം മേഖല തിരഞ്ഞെടുക്കുക --",
      "reg_bus_number": "ബസ് നമ്പർ",
      "reg_upi_label": "💳 നിങ്ങളുടെ UPI ഐഡി (വരുമാനം ലഭിക്കാൻ)",

      // map page
      "map_track_buses": "ബസുകൾ ട്രാക്ക് ചെയ്യുക",
      "map_select_route_to_track": "ട്രാക്ക് ചെയ്യാൻ റൂട്ട് തിരഞ്ഞെടുക്കുക",
      "map_all_routes": "എല്ലാ റൂട്ടുകളും",
      "map_search_placeholder": "ബസ് സ്റ്റോപ്പുകൾ തിരയുക...",
      "tab_track_route": "റൂട്ട് ട്രാക്ക്",
      "tab_map_view": "മാപ്പ് വ്യൂ",
      "trip_origin_label": "ആരംഭ സ്ഥലം",
      "trip_origin_placeholder": "ആരംഭ സ്ഥലം",
      "trip_destination_label": "ലക്ഷ്യസ്ഥാനം",
      "trip_destination_placeholder": "ലക്ഷ്യസ്ഥാനം",

      // routes page
      "routes_title": "റൂട്ടുകളും സമയവിവരങ്ങളും",
      "routes_search_placeholder": "റൂട്ടുകൾ തിരയുക (ഉദാ: കണ്ണൂർ, തലശ്ശേരി)...",

      // booking page
      "book_title": "ടിക്കറ്റ് ബുക്ക് ചെയ്യുക",
      "book_balance": "ബാലൻസ്:",
      "book_from": "എവിടെനിന്ന്",
      "book_select_source": "-- ബോർഡിംഗ് സ്റ്റോപ്പ് തിരഞ്ഞെടുക്കുക --",
      "book_to": "എവിടേക്ക്",
      "book_select_dest": "-- ലക്ഷ്യസ്ഥാനം തിരഞ്ഞെടുക്കുക --",
      "book_select_bus": "ബസ് തിരഞ്ഞെടുക്കുക",
      "book_no_buses": "ഈ റൂട്ടിൽ ബസുകളൊന്നും സജീവമല്ല",
      "book_bus_fare": "ബസ് ചാർജ്:",
      "book_passengers": "യാത്രക്കാരുടെ എണ്ണം",
      "book_student_pass": "🎓 പോയലൂ സ്റ്റുഡന്റ് പാസ് സജീവം! (സൗജന്യ യാത്ര)",
      "book_regular_pass": "🎟️ പോയലൂ പാസ് സജീവം! (സൗജന്യ യാത്ര)",
      "book_pay_using": "പണമടയ്ക്കുന്ന രീതി:",
      "book_pay_wallet": "വാലറ്റ്",
      "book_pay_upi": "UPI / കാർഡ്",
      "book_pay_cash": "കണ്ടക്ടർക്ക് നേരിട്ട് പണം നൽകുക",
      "book_pay_now": "ബുക്ക് ചെയ്ത് പണമടയ്ക്കുക",
      "book_price_per_ticket": "ടിക്കറ്റ് നിരക്ക്",
      "book_total_amount": "ആകെ തുക",

      // wallet page
      "wallet_title": "എന്റെ വാലറ്റ്",
      "wallet_available_bal": "ലഭ്യമായ ബാലൻസ്",
      "wallet_enter_amount": "ചേർക്കേണ്ട തുക നൽകുക (₹)",
      "wallet_pay_with": "പണമടയ്ക്കുന്ന രീതി:",
      "wallet_quick_add": "വേഗത്തിൽ ചേർക്കാൻ:",
      "wallet_add_money_btn": "വാലറ്റിലേക്ക് പണം ചേർക്കുക",
      "wallet_transaction_history": "ഇടപാട് ചരിത്രം",
      "wallet_no_transactions": "ഇടപാടുകൾ ഒന്നും തന്നെയില്ല.",
      "wallet_card_label": "പോയലൂ വാലറ്റ്",
      "wallet_quick_add_title": "വേഗത്തിൽ ചേർക്കുക",
      "wallet_enter_amount_placeholder": "തുക നൽകുക",
      "wallet_pay_using": "പണമടയ്ക്കാൻ",
      "wallet_add_money": "പണം ചേർക്കുക",
      "wallet_secure_note": "🔐 Razorpay വഴി സുരക്ഷിതം · 256-ബിറ്റ് എൻക്രിപ്റ്റ് ചെയ്തത്",
      "wallet_recharge_desc": "റീചാർജ് ചെയ്യുന്നതിനായി ഫിസിക്കൽ അല്ലെങ്കിൽ ഡിജിറ്റൽ പോയലൂ ബസ് പാസിലുള്ള 11 അക്ക കാർഡ് നമ്പർ നൽകുക.",
      "wallet_card_num_label": "11 അക്ക കാർഡ് നമ്പർ",
      "wallet_card_num_placeholder": "ഉദാ: 50991234567",
      "wallet_recharge_amount_placeholder": "റീചാർജ് തുക നൽകുക",
      "wallet_pay_using_colon": "പണമടയ്ക്കുന്ന രീതി:",
      "wallet_recent_txns": "അടുത്തകാലത്തെ ഇടപാടുകൾ",
      "profile_hide_btn": "മറയ്ക്കുക",
      "book_info_desc": "യാത്രാ നിരക്ക് കാണുന്നതിനായി റൂട്ട്, സ്റ്റോപ്പുകൾ, ബസ് എന്നിവ തിരഞ്ഞെടുക്കുക",
      "book_choose_route": "ഒരു റൂട്ട് തിരഞ്ഞെടുക്കുക",
      "book_from_stop_label": "ആരംഭ സ്റ്റോപ്പ്",
      "book_to_stop_label": "ലക്ഷ്യസ്ഥാന സ്റ്റോപ്പ്",
      "book_ticket_count_label": "ടിക്കറ്റുകളുടെ എണ്ണം",
      "book_pay_poyaloo_card_label": "പോയലൂ പാസ് കാർഡ് നമ്പർ ഉപയോഗിച്ച് പണമടയ്ക്കുക (ഓപ്ഷണൽ)",
      "book_pay_poyaloo_card_placeholder": "ഉദാ: 50991234567",
      "book_scan_qr_btn": "QR സ്കാൻ ചെയ്യുക",
      "book_wallet_balance_hint": "നിങ്ങളുടെ സ്വന്തം വാലറ്റ് ബാലൻസ് ഉപയോഗിച്ച് പണമടയ്ക്കാൻ ഇത് വെറുതെ വിടുക.",

      // tickets page
      "tickets_title": "എന്റെ ടിക്കറ്റുകൾ",
      "tickets_active_tab": "സജീവം",
      "tickets_history_tab": "ചരിത്രം",
      "tickets_no_tickets": "ടിക്കറ്റുകൾ ഒന്നും കണ്ടെത്തിയില്ല.",

      // scanner page
      "scanner_title": "കണ്ടക്ടർ ഡാഷ്‌ബോർഡ്",
      "scanner_recent_settlements": "അടുത്തകാലത്തെ സെറ്റിൽമെന്റുകൾ",
      "scanner_no_settlements": "സെറ്റിൽമെന്റുകൾ ഒന്നുമില്ല. വരുമാനം നേടാൻ ടിക്കറ്റുകൾ പരിശോധിക്കുക.",
      "scanner_scan_button": "ടിക്കറ്റ് QR സ്കാൻ ചെയ്യുക",
      "scanner_manual_label": "അല്ലെങ്കിൽ 11 അക്ക പോയലൂ പാസ് നമ്പർ / ടിക്കറ്റ് ഐഡി നൽകുക",
      "scanner_validate_btn": "കാർഡ് / ടിക്കറ്റ് പരിശോധിക്കുക",
      "profile_refresh": "പുതുക്കുക",
      "scanner_save_upi": "UPI വിവരങ്ങൾ സേവ് ചെയ്യുക",
      "scanner_upi_settings_title": "💳 UPI പേയ്മെന്റ് ക്രമീകരണങ്ങൾ",
      "recharge_pass_title": "പോയലൂ പാസ് / വാലറ്റ് റീചാർജ് ചെയ്യുക",
      "recharge_card_btn": "കാർഡും വാലറ്റും റീചാർജ് ചെയ്യുക",
      "scanner_scan_tab": "ടിക്കറ്റ് സ്കാൻ ചെയ്യുക",
      "scanner_validated_tab": "പരിശോധിച്ചവ",
      "scanner_upi_tab": "UPI",
      "scanner_voice_on": "ശബ്ദം ഓൺ",
      "scanner_open_camera": "ക്യാമറ തുറന്ന് സ്കാൻ ചെയ്യുക",
      "scanner_stop_camera": "ക്യാമറ നിർത്തുക",
      "scanner_take_photo": "QR ഫോട്ടോ എടുക്കുക",
      "scanner_from_gallery": "ഗാലറിയിൽ നിന്ന്",
      "scanner_paste_manual": "അല്ലെങ്കിൽ QR ഡാറ്റ നേരിട്ട് നൽകുക",
      "scanner_paste_placeholder": "QR കോഡ് ഡാറ്റ ഇവിടെ പേസ്റ്റ് ചെയ്യുക...",
      "scanner_validate_manual": "സ്ഥിരീകരിക്കുക",

      // pass modal/UI
      "pass_buy_pass_btn": "പോയലൂ പാസ് വാങ്ങുക (₹150)",
      "pass_buy_using": "₹150 അടയ്ക്കാൻ ഉപയോഗിക്കുക:",
      "pass_buy_promo": "ഡിജിറ്റലായോ ഫിസിക്കലായോ യാത്ര ചെയ്യാൻ പോയലൂ ബസ് പാസ് വാങ്ങുക. ഏതു സ്ഥലത്തുനിന്നും കാർഡ് നമ്പർ ഉപയോഗിച്ച് ടോപ്പ്-അപ്പ് ചെയ്യാം.",
      "pass_smart_card": "പോയലൂ പാസ്",
      "pass_smart_card_sub": "കേരള ട്രാവലർ",
      "pass_smart_card_active": "● ആക്റ്റീവ്",
      "pass_smart_card_number": "കാർഡ്: ---- ---- ---",
      "pass_smart_card_balance": "ബാലൻസ്:",
      "owner_assign_title": "ബസ് അസൈൻ ചെയ്യുക",
      "owner_assign_conductor_label": "കണ്ടക്ടർ (പേര് അല്ലെങ്കിൽ മൊബൈൽ)",
      "owner_assign_btn": "അസൈൻ ചെയ്യുക",
      "select_bus_placeholder": "ബസ് തിരഞ്ഞെടുക്കുക",
      "select_route_placeholder": "റൂട്ട് തിരഞ്ഞെടുക്കുക",
      "select_conductor_placeholder": "കണ്ടക്ടറെ തിരഞ്ഞെടുക്കുക",
      "owner_buses_conductors_title": "നിങ്ങളുടെ ബസുകളും കണ്ടക്ടർമാരും",
      "profile_group_chat": "ഗ്രൂപ്പ് ചാറ്റ്",
      "profile_community_chat": "കമ്മ്യൂണിറ്റി ചാറ്റ്",
      "chat_general": "ജനറൽ",
      "chat_movies": "സിനിമകൾ",
      "chat_dating": "ഡേറ്റിംഗ്",
      "chat_politics": "രാഷ്ട്രീയം",
      "owner_sub_pay_btn": "സബ്‌സ്‌ക്രിപ്ഷൻ തുക അടയ്ക്കുക",
      "sub_status_active": "സജീവം",
      "sub_status_inactive": "നിഷ്ക്രിയം",
      "plan_thirty_days_used": "30 ദിവസത്തേക്ക് (ഒരു തവണ മാത്രം — ഇതിനകം ഉപയോഗിച്ചു)",
      "plan_thirty_days": "30 ദിവസത്തേക്ക്",
      "select_bus_number": "ബസ് നമ്പർ തിരഞ്ഞെടുക്കുക",
      "select_route": "റൂട്ട് തിരഞ്ഞെടുക്കുക",
      "select_conductor": "കണ്ടക്ടറെ തിരഞ്ഞെടുക്കുക",
      "available_conductors": "✓ ലഭ്യമായ കണ്ടക്ടർമാർ",
      "currently_assigned": "⚠️ നിലവിൽ അസൈൻ ചെയ്തവർ",
      "assigned": "അസൈൻ ചെയ്തവർ",
      "not_assigned": "അസൈൻ ചെയ്തിട്ടില്ല",
      "processing": "പ്രോസസ്സ് ചെയ്യുന്നു..."
    }
  };

  // Export globally
  window.translations = translations;

  window.t = function(key, defaultText) {
    const currentLang = localStorage.getItem('app_lang') || 'en';
    if (translations[currentLang] && translations[currentLang][key]) {
      return translations[currentLang][key];
    }
    return defaultText || key;
  };

  window.applyTranslations = function() {
    const currentLang = localStorage.getItem('app_lang') || 'en';
    
    // Update body class for font styling
    if (currentLang === 'ml') {
      document.body.classList.add('lang-ml');
    } else {
      document.body.classList.remove('lang-ml');
    }

    // Update lang switcher badge text and select state
    const codeBtn = document.getElementById('auth-lang-code-btn');
    if (codeBtn) {
      codeBtn.textContent = currentLang.toUpperCase();
    }
    const selectEl = document.getElementById('auth-lang-select');
    if (selectEl) {
      selectEl.value = currentLang;
    }

    // Translate DOM elements with data-i18n attributes
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[currentLang] && translations[currentLang][key]) {
        const transVal = translations[currentLang][key];
        
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = transVal;
        } else if (el.tagName === 'OPTION') {
          el.textContent = transVal;
        } else {
          // Keep inner icons/elements intact if a specific attribute target is requested
          const targetAttr = el.getAttribute('data-i18n-target');
          if (targetAttr) {
            el.setAttribute(targetAttr, transVal);
          } else {
            // Avoid resetting text if it contains children
            el.textContent = transVal;
          }
        }
      }
    });

    // Notify application modules of language change
    const event = new CustomEvent('languageChanged', { detail: { language: currentLang } });
    document.dispatchEvent(event);
  };

  window.setLanguage = function(lang) {
    localStorage.setItem('app_lang', lang);
    applyTranslations();
  };
})();
