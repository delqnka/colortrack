import React, { useEffect, useCallback, useState, useRef } from 'react';
import { View, Pressable, Text, TextInput, Platform, useWindowDimensions, DeviceEventEmitter } from 'react-native';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import * as SplashScreen from 'expo-splash-screen';
import { NavigationContainer } from '@react-navigation/native';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import NetInfo from '@react-native-community/netinfo';

import HomeScreen from './src/screens/HomeScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import ClientDetailScreen from './src/screens/ClientDetailScreen';
import ClientFormScreen from './src/screens/ClientFormScreen';
import AppointmentFormScreen from './src/screens/AppointmentFormScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import InventoryItemScreen from './src/screens/InventoryItemScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import FormulaBuilderScreen from './src/screens/FormulaBuilderScreen';
import VisitDetailScreen from './src/screens/VisitDetailScreen';
import LabScreen from './src/screens/LabScreen';
import FinanceScreen from './src/screens/FinanceScreen';
import LoginScreen from './src/screens/LoginScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { CurrencyProvider } from './src/context/CurrencyContext';
import { loadStoredToken, flushOutbox } from './src/api/client';
import { registerExpoPushIfPossible } from './src/push/registerPush';
import { BRAND_PURPLE, glassPurpleTabBar } from './src/theme/glassUi';
import { FontFamily } from './src/theme/fonts';

SplashScreen.preventAutoHideAsync().catch(() => {});

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Side margin: ~6.5% + min 18px + safe area */
const TAB_H = 64;
/** Active white circle = full bar height (diameter TAB_H), like reference */
const ICON_KNOB = TAB_H;
const ICON_SIZE_ACTIVE = 28;
const ICON_SIZE_INACTIVE = 22;
const TAB_SIDE_RATIO = 0.065;
const TAB_SIDE_MIN = 18;

function MainTabs() {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const baseSide = Math.max(TAB_SIDE_MIN, Math.round(windowWidth * TAB_SIDE_RATIO));
  const padLeft = baseSide + insets.left;
  const padRight = baseSide + insets.right;
  const bottomOffset = Math.max(insets.bottom, 12) + 20;

  const screenOptions = ({ route }) => ({
    headerShown: false,
    tabBarShowLabel: false,
    tabBarButton: (props) => (
      <Pressable
        {...props}
        android_ripple={{ borderless: true }}
        style={({ pressed }) => [
          typeof props.style === 'function' ? props.style({ pressed }) : props.style,
          {
            flex: 1,
            height: TAB_H,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 0,
            paddingVertical: 0,
            paddingHorizontal: 0,
            margin: 0,
          },
        ]}
      />
    ),
    tabBarItemStyle: {
      height: TAB_H,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 0,
      margin: 0,
    },
    tabBarIconStyle: {
      width: ICON_KNOB,
      height: TAB_H,
      margin: 0,
      marginTop: 0,
    },
    // RN BottomTabBar forces start/end: 0 — left/right in tabBarStyle do not inset. Real inset = wrapper padding.
    tabBarStyle: {
      height: TAB_H,
      minHeight: TAB_H,
      maxHeight: TAB_H,
      paddingHorizontal: 12,
      paddingTop: 0,
      paddingBottom: 0,
      borderRadius: TAB_H / 2,
      borderTopWidth: 0,
      ...glassPurpleTabBar,
      elevation: 18,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
    },
    tabBarIcon: ({ focused }) => {
      const sfSymbols = {
        Dashboard: focused ? 'house.fill'        : 'house',
        Clients:   focused ? 'person.2.fill'     : 'person.2',
        Inventory: focused ? 'cabinet.fill'      : 'cabinet',
        Calendar:  focused ? 'calendar.fill'     : 'calendar',
      };
      const ionicons = {
        Dashboard: focused ? 'home'              : 'home-outline',
        Clients:   focused ? 'people'            : 'people-outline',
        Inventory: focused ? 'filing'            : 'filing-outline',
        Calendar:  focused ? 'calendar'          : 'calendar-outline',
      };
      const sf = sfSymbols[route.name] || 'circle';
      const size = focused ? ICON_SIZE_ACTIVE : ICON_SIZE_INACTIVE;
      const iconColor = focused ? BRAND_PURPLE : '#FFFFFF';

      const icon = Platform.OS === 'ios'
        ? <SymbolView name={sf} size={size} tintColor={iconColor} weight={focused ? 'semibold' : 'regular'} type="hierarchical" style={{ width: size, height: size }} />
        : <Ionicons name={ionicons[route.name] || 'home-outline'} size={size} color={iconColor} />;

      return (
        <View style={{ width: ICON_KNOB, height: TAB_H, justifyContent: 'center', alignItems: 'center' }}>
          {focused ? (
            <View style={{
              width: ICON_KNOB, height: ICON_KNOB, borderRadius: ICON_KNOB / 2,
              backgroundColor: 'rgba(255,255,255,0.92)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)',
              justifyContent: 'center', alignItems: 'center',
              shadowColor: '#000000', shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.45, shadowRadius: 6, elevation: 10,
            }}>
              {icon}
            </View>
          ) : icon}
        </View>
      );
    },
  });

  return (
    <Tab.Navigator
      tabBar={(props) => (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingLeft: padLeft,
            paddingRight: padRight,
            paddingBottom: bottomOffset,
          }}
        >
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={screenOptions}
    >
      <Tab.Screen name="Dashboard" component={HomeScreen} />
      <Tab.Screen name="Clients" component={ClientsScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const textFontDefaultsApplied = useRef(false);

  const refreshAuth = useCallback(async () => {
    const t = await loadStoredToken();
    setSignedIn(Boolean(t));
    setAuthReady(true);
    if (t) {
      await flushOutbox();
      registerExpoPushIfPossible();
    }
  }, []);

  useEffect(() => {
    refreshAuth();
    const sub = NetInfo.addEventListener(() => {
      flushOutbox();
    });
    return () => sub();
  }, [refreshAuth]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('colortrack:session-cleared', () => {
      setSignedIn(false);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!fontsLoaded || textFontDefaultsApplied.current) return;
    textFontDefaultsApplied.current = true;
    const base = { fontFamily: FontFamily.regular };
    const merge = (Comp) => {
      const prev = Comp.defaultProps?.style;
      const nextStyle =
        prev == null
          ? base
          : Array.isArray(prev)
            ? [...prev, base]
            : [prev, base];
      Comp.defaultProps = { ...Comp.defaultProps, style: nextStyle };
    };
    merge(Text);
    merge(TextInput);
    SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded || !authReady) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: '#fff' }} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <CurrencyProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {!signedIn ? (
              <Stack.Screen name="Login">
                {() => <LoginScreen onLoggedIn={() => setSignedIn(true)} />}
              </Stack.Screen>
            ) : (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
                <Stack.Screen name="ClientForm" component={ClientFormScreen} />
                <Stack.Screen name="AppointmentForm" component={AppointmentFormScreen} />
                <Stack.Screen name="InventoryItem" component={InventoryItemScreen} />
                <Stack.Screen name="FormulaBuilder" component={FormulaBuilderScreen} />
                <Stack.Screen name="VisitDetail" component={VisitDetailScreen} />
                <Stack.Screen name="Finance" component={FinanceScreen} />
                <Stack.Screen name="Lab" component={LabScreen} />
                <Stack.Screen name="Profile" component={ProfileScreen} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </CurrencyProvider>
    </SafeAreaProvider>
  );
}
