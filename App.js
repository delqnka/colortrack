import React from 'react';
import { View, Pressable, useWindowDimensions } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from './src/screens/HomeScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import ClientDetailScreen from './src/screens/ClientDetailScreen';
import ClientFormScreen from './src/screens/ClientFormScreen';
import AppointmentFormScreen from './src/screens/AppointmentFormScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import InventoryItemScreen from './src/screens/InventoryItemScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import FormulaBuilderScreen from './src/screens/FormulaBuilderScreen';

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
      backgroundColor: '#000000',
      borderRadius: TAB_H / 2,
      borderTopWidth: 0,
      elevation: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 20,
    },
    tabBarIcon: ({ focused }) => {
      let iconName;
      if (route.name === 'Dashboard') iconName = focused ? 'home' : 'home-outline';
      else if (route.name === 'Clients') iconName = focused ? 'people' : 'people-outline';
      else if (route.name === 'Inventory') iconName = focused ? 'cube' : 'cube-outline';
      else iconName = focused ? 'calendar' : 'calendar-outline';

      const size = focused ? ICON_SIZE_ACTIVE : ICON_SIZE_INACTIVE;

      return (
        <View
          style={{
            width: ICON_KNOB,
            height: TAB_H,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {focused ? (
            <View
              style={{
                width: ICON_KNOB,
                height: ICON_KNOB,
                borderRadius: ICON_KNOB / 2,
                backgroundColor: '#FFFFFF',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons name={iconName} size={size} color="#000000" />
            </View>
          ) : (
            <Ionicons name={iconName} size={size} color="#FFFFFF" />
          )}
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
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
          <Stack.Screen name="ClientForm" component={ClientFormScreen} />
          <Stack.Screen name="AppointmentForm" component={AppointmentFormScreen} />
          <Stack.Screen name="InventoryItem" component={InventoryItemScreen} />
          <Stack.Screen name="FormulaBuilder" component={FormulaBuilderScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
