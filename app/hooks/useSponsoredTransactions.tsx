"use client";

import { useState, useCallback } from 'react';
import { useWallets, useSendTransaction } from '@privy-io/react-auth';
import { 
  prepareSponsoredTokenTransfer, 
  isGasSponsorshipAvailable,
  type TokenTransferParams 
} from '@/lib/smart-wallet-utils';

export interface SponsoredTransactionStatus {
  isLoading: boolean;
  isSponsored: boolean;
  transactionHash?: string;
  error?: string;
}

export interface UseSponsoredTransactionsReturn {
  sendSponsoredTransaction: (params: TokenTransferParams) => Promise<void>;
  checkSponsorship: (params: TokenTransferParams) => Promise<boolean>;
  status: SponsoredTransactionStatus;
  reset: () => void;
}

/**
 * Hook for sending transactions with Alchemy gas sponsorship
 * Integrates Privy smart wallets with proper Alchemy Gas Manager API
 */
export function useSponsoredTransactions(): UseSponsoredTransactionsReturn {
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  
  const [status, setStatus] = useState<SponsoredTransactionStatus>({
    isLoading: false,
    isSponsored: false,
  });

  const smartWallet = wallets?.find(wallet => wallet.address);

  const reset = useCallback(() => {
    setStatus({
      isLoading: false,
      isSponsored: false,
    });
  }, []);

  const checkSponsorship = useCallback(async (params: TokenTransferParams): Promise<boolean> => {
    if (!smartWallet?.address) {
      throw new Error('No smart wallet connected');
    }

    try {
      const isEligible = await isGasSponsorshipAvailable(
        {
          to: params.recipient,
          chainId: params.chainId,
        },
        smartWallet.address
      );

      return isEligible;
    } catch (error) {
      console.warn('Failed to check sponsorship eligibility:', error);
      return false;
    }
  }, [smartWallet]);

  const sendSponsoredTransaction = useCallback(async (params: TokenTransferParams) => {
    if (!smartWallet?.address) {
      throw new Error('No smart wallet connected');
    }

    setStatus(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      console.log('🚀 Attempting sponsored transaction:', params);
      
      // Always try sponsorship first, but with better error handling
      setStatus(prev => ({ ...prev, isSponsored: true }));

      // Build transaction parameters with proper decimals
      const decimals = params.decimals || 18;
      const txParams = params.tokenAddress 
        ? {
            // ERC-20 token transfer
            to: params.tokenAddress as `0x${string}`,
            data: buildTransferCallData(params.recipient, params.amount, decimals),
          }
        : {
            // Native ETH transfer  
            to: params.recipient as `0x${string}`,
            value: BigInt(parseFloat(params.amount) * Math.pow(10, 18)),
          };

      console.log('📝 Transaction parameters:', txParams);

      // Try to send the transaction
      const result = await sendTransaction(txParams);
      
      setStatus(prev => ({ 
        ...prev, 
        isLoading: false, 
        transactionHash: result.hash 
      }));

      console.log('✅ Transaction sent successfully:', result.hash);
      
    } catch (error) {
      console.error('❌ Transaction failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      // If it's a sponsorship-related error, try fallback
      if (errorMessage.includes('sponsorship') || errorMessage.includes('paymaster') || errorMessage.includes('gas too low')) {
        console.log('⚠️ Sponsorship failed, falling back to user-paid transaction');
        
        try {
          setStatus(prev => ({ ...prev, isSponsored: false }));
          
          // Build transaction parameters again
          const decimals = params.decimals || 18;
          const txParams = params.tokenAddress 
            ? {
                to: params.tokenAddress as `0x${string}`,
                data: buildTransferCallData(params.recipient, params.amount, decimals),
                gasLimit: BigInt(100000), // Explicit gas limit for token transfers
              }
            : {
                to: params.recipient as `0x${string}`,
                value: BigInt(parseFloat(params.amount) * Math.pow(10, 18)),
                gasLimit: BigInt(21000), // Standard ETH transfer gas
              };

          const fallbackResult = await sendTransaction(txParams);
          
          setStatus(prev => ({ 
            ...prev, 
            isLoading: false, 
            transactionHash: fallbackResult.hash 
          }));

          console.log('✅ Fallback transaction sent:', fallbackResult.hash);
          
        } catch (fallbackError) {
          console.error('❌ Fallback transaction also failed:', fallbackError);
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Fallback transaction failed';
          
          setStatus(prev => ({ 
            ...prev, 
            isLoading: false, 
            error: fallbackErrorMessage 
          }));

          throw new Error(`Transaction failed: ${fallbackErrorMessage}`);
        }
      } else {
        setStatus(prev => ({ 
          ...prev, 
          isLoading: false, 
          error: errorMessage 
        }));

        throw error;
      }
    }
  }, [smartWallet, sendTransaction]);

  return {
    sendSponsoredTransaction,
    checkSponsorship,
    status,
    reset,
  };
}

/**
 * Build call data for ERC-20 token transfer
 */
function buildTransferCallData(
  recipient: string, 
  amount: string, 
  decimals: number = 18
): `0x${string}` {
  const transferSelector = '0xa9059cbb';
  const recipientPadded = recipient.slice(2).padStart(64, '0');
  const tokenAmount = BigInt(parseFloat(amount) * Math.pow(10, decimals));
  const amountPadded = tokenAmount.toString(16).padStart(64, '0');
  
  return `${transferSelector}${recipientPadded}${amountPadded}` as `0x${string}`;
} 