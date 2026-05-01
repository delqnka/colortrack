import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { normalizeCurrencyCode, currencyCodeIsSupported } from '../constants/currencyCodes';
import { loadCurrencyPreference, persistCurrencyPreference } from '../preferences/currencyStorage';

const CurrencyCtx = createContext({
  currency: 'USD',
  ready: false,
  /** @returns {Promise<void>} */
  setCurrency: async () => {},
});

const EV = 'colortrack:currency-changed';

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyState] = useState('USD');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const raw = await loadCurrencyPreference('USD');
      const c = normalizeCurrencyCode(raw, 'USD');
      if (!cancel) {
        setCurrencyState(c);
        setReady(true);
      }
    })();

    const sub = DeviceEventEmitter.addListener(EV, (payload) => {
      const code = payload && typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
      if (currencyCodeIsSupported(code)) setCurrencyState(code);
    });
    return () => {
      cancel = true;
      sub.remove();
    };
  }, []);

  const setCurrency = useCallback(async (iso4217Upper) => {
    const candidate = normalizeCurrencyCode(String(iso4217Upper || ''), 'USD');
    await persistCurrencyPreference(candidate);
    setCurrencyState(candidate);
    DeviceEventEmitter.emit(EV, { code: candidate });
  }, []);

  const val = useMemo(() => ({ currency, ready, setCurrency }), [currency, ready, setCurrency]);

  return <CurrencyCtx.Provider value={val}>{children}</CurrencyCtx.Provider>;
}

export function useCurrency() {
  return useContext(CurrencyCtx);
}
