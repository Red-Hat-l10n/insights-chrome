import React, { createContext, useContext, useEffect, useRef } from 'react';
import { AnalyticsBrowser } from '@segment/analytics-next';
import { getUrl, isBeta, isProd } from '../../utils';
import { useSelector } from 'react-redux';
import { ChromeUser } from '@redhat-cloud-services/types';
import { useLocation } from 'react-router-dom';

type SegmentEnvs = 'dev' | 'prod';
type SegmentModules = 'openshift';

const KEY_FALLBACK = {
  prod: 'nm7VsnYsBVJ9MqjaVInft69pAkhCXq9Q',
  dev: 'Aoak9IFNixtkZJRatfZG9cY1RHxbATW1',
};

function getAdobeVisitorId() {
  const visitor = window?.s?.visitor;
  if (visitor) {
    return visitor.getMarketingCloudVisitorID();
  }

  return -1;
}

const getAPIKey = (env: SegmentEnvs = 'dev', module: SegmentModules) =>
  ({
    prod: {
      openshift: 'z3Ic4EtzJtHrhXfpKgViJmf2QurSxXb9',
    },
    dev: {
      openshift: 'A8iCO9n9Ax9ObvHBgz4hMC9htKB0AdKj',
    },
  }[env]?.[module] || KEY_FALLBACK[env]);

const registerUrlObserver = () => {
  /**
   * We ignore hash changes
   * Hashes only have frontend effect
   */
  let oldHref = document.location.href.replace(/#.*$/, '');

  const bodyList = document.body;
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(() => {
      const newLocation = document.location.href.replace(/#.*$/, '');
      if (oldHref !== newLocation) {
        oldHref = newLocation;
        window?.sendCustomEvent?.('pageBottom');
        setTimeout(() => {
          window.segment?.page(window?._segment?.pageOptions);
        });
      }
    });
  });
  observer.observe(bodyList, {
    childList: true,
    subtree: true,
  });
  return observer.disconnect;
};

const isInternal = (email = '') => /@(redhat\.com|.*ibm\.com)$/gi.test(email);

const emailDomain = (email = '') => (/@/g.test(email) ? email.split('@')[1].toLowerCase() : null);

const getPagePathSegment = (pathname: string, n: number) => pathname.split('/')[n] || '';

const getIdentityTrais = (user: ChromeUser, pathname: string, activeModule = '') => {
  const entitlements = Object.entries(user.entitlements).reduce(
    (acc, [key, entitlement]) => ({
      ...acc,
      [`entitlements_${key}`]: entitlement.is_entitled,
      [`entitlements_${key}_trial`]: entitlement.is_trial,
    }),
    {}
  );
  const email = user.identity.user?.email;
  return {
    cloud_user_id: user.identity.internal?.account_id,
    adobe_cloud_visitor_id: getAdobeVisitorId(),
    internal: isInternal(email),
    email_domain: emailDomain(email),
    lang: user.identity.user?.locale,
    isOrgAdmin: user.identity.user?.is_org_admin,
    currentBundle: getUrl('bundle'),
    currentApp: activeModule,
    isBeta: isBeta(),
    ...[...Array(5)].reduce(
      (acc, _, i) => ({
        ...acc,
        [`urlSegment${i + 1}`]: getPagePathSegment(pathname, i + 1),
      }),
      {}
    ),
    ...entitlements,
  };
};

export const SegmentContext = createContext<{ ready: boolean; analytics?: AnalyticsBrowser }>({
  ready: false,
  analytics: undefined,
});

export type SegmentProviderProps = {
  activeModule: string;
};

export const SegmentProvider: React.FC<SegmentProviderProps> = ({ activeModule, children }) => {
  const analytics = useRef<AnalyticsBrowser>();
  const user = useSelector(({ chrome: { user } }: { chrome: { user: ChromeUser } }) => user);
  const { pathname } = useLocation();
  useEffect(() => {
    const disconnect = registerUrlObserver();
    return () => disconnect();
  }, []);

  useEffect(() => {
    if (activeModule && user) {
      const newKey = getAPIKey(isProd() ? 'prod' : 'dev', activeModule as SegmentModules);
      const identityTraits = getIdentityTrais(user, pathname, activeModule);
      const identityOptions = {
        context: {
          groupId: user.identity.internal?.org_id,
        },
        cloud_user_id: user.identity.internal?.account_id,
        adobe_cloud_visitor_id: getAdobeVisitorId(),
      };
      const groupOptions = {
        account_number: user.identity.account_number,
        account_id: user.identity.internal?.org_id,
      };
      if (!analytics.current) {
        analytics.current = AnalyticsBrowser.load({ writeKey: newKey }, { initialPageview: false });
        window.segment = analytics.current;
        analytics.current.identify(user.identity.internal?.account_id, identityTraits, identityOptions);
        analytics.current.group(user.identity.account_number, groupOptions);
        analytics.current.page();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore TS does not allow accessing the instance settings but its necessary for us to not create instances if we don't have to
      } else if (analytics.current?.instance?.settings.writeKey !== newKey) {
        window.segment = undefined;
        analytics.current = AnalyticsBrowser.load({ writeKey: newKey }, { initialPageview: false });
        window.segment = analytics.current;
        analytics.current.identify(user.identity.internal?.account_id, identityTraits, identityOptions);
        analytics.current.group(user.identity.account_number, groupOptions);
      }
    }
  }, [activeModule, user]);

  return (
    <SegmentContext.Provider
      value={{
        ready: true,
        analytics: analytics.current,
      }}
    >
      {children}
    </SegmentContext.Provider>
  );
};

export function useSegment() {
  const ctx = useContext(SegmentContext);
  if (!ctx) {
    throw new Error('Context used outside of its Provider!');
  }
  return ctx;
}
