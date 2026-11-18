  // Bulgarian texts for features/location (keyed by the English text; see shared/ui/i18n.js)
  Object.assign(BG, {
    // the location button
    'Show my location': 'Покажи местоположението ми',
    'Finding your location… (tap to cancel)': 'Търсене на местоположението Ви… (докоснете за отказ)',
    'Turn off my location': 'Изключи местоположението ми',
    'Back to my location': 'Обратно към местоположението ми',
    // waiting and errors
    'This browser has no location access.': 'Този браузър няма достъп до местоположението.',
    'Location failed: {err}': 'Грешка при местоположението: {err}',
    'Still looking for you… Is location (GPS) turned on on the device?': 'Все още Ви търсим… Включено ли е местоположението (GPS) на устройството?',
    'No location yet — is location (GPS) turned on on the device?': 'Още няма местоположение — включено ли е местоположението (GPS) на устройството?',
    'Location only works on a secure page (https or localhost). Start the local server (“Sofia Transport” shortcut or python serve.py) and open http://localhost:8080/.': 'Местоположението работи само на защитена страница (https или localhost). Стартирайте локалния сървър (пряк път „Sofia Transport“ или python serve.py) и отворете http://localhost:8080/.',
    'Location isn’t available here: the app is opened from a file on the device ({proto}//…), and browsers usually don’t give location to files (there’s no site setting for them). Open it from its https address to use location (see the documentation, “Host it”).': 'Тук няма местоположение: приложението е отворено от файл на устройството ({proto}//…), а браузърите обикновено не дават местоположение на файлове (за тях няма настройка на сайта). Отворете го от https адреса му, за да ползвате местоположението (вижте документацията, „Host it“).',
    'Location is blocked for this site. Allow it in the browser’s site settings (the icon left of the address), then tap the button again.': 'Местоположението е блокирано за този сайт. Разрешете го в настройките на сайта в браузъра (иконата вляво от адреса), после докоснете бутона отново.',
    'The device refused location to the browser. Turn location on and let the browser use it (Android: Settings → Apps → Chrome → Permissions → Location), then tap again.': 'Устройството не дава местоположение на браузъра. Включете местоположението и го разрешете за браузъра (Android: Настройки → Приложения → Chrome → Разрешения → Местоположение), после докоснете отново.',
    // the note about secure pages
    'Location needs a secure page. Open the app from its web address to use it.': 'Местоположението изисква защитена страница. Отворете приложението от уеб адреса му, за да го ползвате.',
    'On iPhone, location needs the app opened from an https address (documentation, “Host it”).': 'На iPhone местоположението изисква приложението да е отворено от https адрес (документацията, „Host it“).',
    'Location needs the local server. Start “Sofia Transport” (Termux), then tap Open.': 'Местоположението изисква локалния сървър. Стартирайте „Sofia Transport“ (Termux), после докоснете „Отвори“.'
  });
