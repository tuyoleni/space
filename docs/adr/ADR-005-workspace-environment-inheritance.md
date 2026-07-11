# ADR-005: Workspace environment inheritance

## Status
Pending — resolved during M2 (Phase 1: secure application foundation)

## Context
Spec section 40.5: define the exact allow-list/deny-list, PATH construction, proxy variables,
locale, certificate variables, and child-process environment policy. Section 5.3 defines the
environment precedence order (OS base -> machine tool paths -> workspace tool paths/vars ->
project runtime/vars -> secrets -> operation-specific vars) and requires an allow/deny policy
for inherited variables so sensitive host values are not blindly inherited.

## Decision
_To be filled in during M2 implementation (Workspace Process Runner)._

## Consequences
_Pending._
